/**
 * On-demand graph refresh — the FOLDER path (LS-06).
 *
 * `refreshFolderGraph` is the host-neutral freshness step that runs BEFORE a
 * folder projection (document-folder, and future viewer/CLI callers). It
 * brings the persistent edge-list stores up to date with the current state of
 * a subtree on disk, then returns the {@link ScanCoverage} so the caller can
 * surface a §7 "COVERAGE NOTES" caveat (LS-04) when files were dropped.
 *
 * Composition (this file is a THIN wrapper — it does not duplicate gate logic):
 *   - LS-05 scan-manifest:  readManifest / diffManifest / writeManifest decide
 *     which files are new / changed / deleted SINCE the last scan, by comparing
 *     a stat-only FS snapshot against the persisted fingerprint sidecar.
 *   - LS-03 filtered scan:  scanFolderRecursive applies the denylist / size /
 *     line gates and RECORDS coverage — we reuse it verbatim to repopulate the
 *     stores rather than re-implementing the gates here.
 *   - removeByFile (edgelist.ts, LS-07): precise per-file edge removal for
 *     changed + deleted files — purges edges by SOURCE *and* TARGET, so a
 *     deleted file with incoming imports/calls leaves no stale inbound edge.
 *   - LS-10 atomic save: both stores publish via temp+rename under the
 *     in-process mutex; writeManifest publishes atomically too.
 *
 * Warm vs cold path
 * -----------------
 *   - WARM (no diff): stat-walk the subtree + diff (empty) → return an empty
 *     coverage WITHOUT any parse / store write. `changed` is hash-based behind
 *     an mtime+size PRE-FILTER, so an unchanged-fingerprint file is never read;
 *     only a file whose mtime/size moved is hashed to confirm warm-vs-cold.
 *     This is the steady state and stays read-free for unchanged files.
 *   - COLD / CHANGED (any new/changed/deleted under the subtree): remove the
 *     changed+deleted files' source-side edges, run the filtered
 *     scanFolderRecursive over the subtree to repopulate (which re-gates and
 *     produces fresh coverage), then rewrite the manifest from the walk + the
 *     coverage buckets and save everything.
 *   - 'skip' refresh: no-op the freshness work entirely (no stat-walk, no diff,
 *     no parse) and return an empty coverage. The projection in document-folder
 *     still runs against whatever the stores currently hold.
 *
 * LS-07: per-file removal now routes through `removeByFile` (edgelist.ts),
 * which purges edges by SOURCE *and* TARGET, so a changed/deleted file that is
 * the TARGET of another file's edge no longer keeps a stale inbound edge. The
 * graph-build import-edge dangling-node filter (graph/index.ts) is the
 * self-healing safety net that drops any import edge whose endpoint is neither
 * a real file-node nor an external module.
 *
 * §6 DEFERRAL: a cold/changed refresh runs a SYNCHRONOUS full subtree scan. A
 * hard latency/work budget + timeout that emits a coverage caveat (never
 * partial-as-complete) is a planned follow-up, NOT built here.
 */

import { ImportEdgeListStore, CallEdgeListStore } from '../../graph/edgelist';
import { ParserRegistry } from '../../parser/registry';
import { scanFolderRecursive, type ScanCoverage } from '../scan';
import {
    readManifest,
    diffManifest,
    writeManifest,
    hashFile,
    type Manifest,
    type ManifestEntry,
    type ManifestStatus,
} from '../scan-manifest';
import type { WorkspaceContext } from '../workspace-context';
import { emptyCoverage, walkFsStats } from './shared';

/** Per-call options for {@link refreshFolderGraph}. */
export interface RefreshFolderGraphOptions {
    /** Workspace-relative folder path (forward slashes) to refresh. */
    folderPath: string;
    /**
     * `'auto'` (default): bring the subtree's edges up to date (warm = stat +
     * diff only; cold/changed = remove + filtered rescan + manifest rewrite).
     * `'skip'`: no freshness work at all — project the current stores as-is.
     * LS-09 plumbs this through from the MCP schema; LS-06 defaults to 'auto'.
     */
    refresh?: 'auto' | 'skip';
}

/**
 * Refresh the edge-list stores for the subtree at `opts.folderPath` and return
 * the {@link ScanCoverage} of the scan that produced the current edges.
 *
 * Host-neutral: takes only a {@link WorkspaceContext}, so CLI `document`, the
 * MCP `folder_info` path, and a future viewer all reuse it. See the module
 * header for the warm/cold/skip behavior and the LS-07 by-target blindspot.
 */
export async function refreshFolderGraph(
    ctx: WorkspaceContext,
    opts: RefreshFolderGraphOptions,
): Promise<ScanCoverage> {
    const { folderPath, refresh = 'auto' } = opts;

    // 'skip' — no freshness work at all. The caller still projects the
    // current stores; we just don't touch them or pay the stat-walk.
    if (refresh === 'skip') {
        return emptyCoverage();
    }

    // Stat-only snapshot of the subtree + diff against the manifest. This is
    // the entire WARM-path cost (no file reads, no parse, no store writes).
    const fsStats = await walkFsStats(ctx, folderPath);
    const manifest = await readManifest(ctx);
    const subtreePrefix = folderPath.replace(/\\/g, '/');

    // CHEAP PRE-FILTER → HASH: enrich ONLY the entries whose mtime/size moved
    // from the manifest so we hash the minimal set. An unchanged-fingerprint
    // file is left hash-undefined → diffManifest's mtime+size branch keeps it
    // warm with no read. walkFsStats returns mutable plain objects, so mutating
    // `st.hash` in place is safe.
    for (const [rel, st] of Object.entries(fsStats)) {
        const prev = manifest.files[rel];
        const moved =
            prev === undefined ||
            prev.mtimeMs !== st.mtimeMs ||
            prev.size !== st.size;
        // Hash every new-or-moved file. We hash NEW files too (no
        // `prev !== undefined` guard) so the cold scan persists a hash for them
        // immediately — this is what lets a subsequent touch-without-edit stay
        // WARM. Aligning with the single-file path, which also hashes new files.
        // (Unchanged-fingerprint files are skipped → never read.)
        if (moved) {
            st.hash = await hashFile(ctx.io, rel);
        }
    }

    const diff = diffManifest(manifest, fsStats, subtreePrefix);

    const hasChanges =
        diff.new.length > 0 || diff.changed.length > 0 || diff.deleted.length > 0;

    // WARM PATH: nothing new / changed / deleted under the subtree → return
    // without parsing or writing. Edges already reflect the current FS.
    if (!hasChanges) {
        return emptyCoverage();
    }

    // COLD / CHANGED PATH.
    const { io } = ctx;
    const importStore = new ImportEdgeListStore(ctx.artifactRoot, io);
    const callStore = new CallEdgeListStore(ctx.artifactRoot, io);

    // Remove edges for changed + deleted files on BOTH stores. removeByFile
    // (LS-07) is precise to one file and purges edges where the file is the
    // SOURCE *or* the TARGET, so a deleted file with INCOMING imports/calls no
    // longer leaves a stale inbound edge.
    //
    // Loop K2: each store's load→remove→save runs under ONE write-lock hold
    // (withTransaction) so a concurrent writer on the same edge-list file can't
    // clobber these removals. The two stores write DISTINCT files (import vs
    // call), so their transactions take independent locks. Persist BEFORE the
    // rescan reloads its own store instances (scanFolderRecursive constructs
    // fresh stores and load()s from disk), so deleted files' edges don't
    // survive via a stale on-disk copy.
    const changedOrDeleted = [...diff.changed, ...diff.deleted];
    await importStore.withTransaction(() => {
        for (const rel of changedOrDeleted) {
            importStore.removeByFile(rel);
        }
    });
    await callStore.withTransaction(() => {
        for (const rel of changedOrDeleted) {
            callStore.removeByFile(rel);
        }
    });

    // Drop cached per-workspace parser state (the TS adapter caches one
    // ts.Program per root for scan perf; it never self-refreshes). Without
    // this, a long-lived process re-scanning after an edit would re-parse the
    // STALE cached Program and the new content would be invisible. Safe to run
    // only on the cold/changed path — the warm path already returned above.
    ParserRegistry.getInstance().invalidateCaches(ctx.workspaceRoot);

    // Repopulate via the LS-03 filtered scan over the subtree. This re-gates
    // (denylist / size / lines), re-parses, and RECORDS coverage. New +
    // changed files get fresh edges; the filtered scan is the single source
    // of gate logic (no duplication here).
    //
    // §6 DEFERRAL: this synchronous full subtree scan on cold/changed is
    // accepted as-is; a latency/work budget + timeout (never
    // partial-as-complete) is a planned follow-up, not built here.
    const scanResult = await scanFolderRecursive(ctx, { folderPath });
    const coverage = scanResult.coverage;

    // Rebuild the manifest for every file seen in the walk. Status is derived
    // from the coverage buckets; files that passed all gates default to
    // 'parsed'. Deleted files are simply omitted (they're gone from fsStats).
    const skippedSize = new Set(coverage.skippedSize);
    const skippedLines = new Set(coverage.skippedLines);
    const skippedDenylist = new Set(coverage.skippedDenylist);
    const parseErrors = new Set(coverage.parseErrors.map((e) => e.filePath));

    const statusFor = (rel: string): ManifestStatus => {
        if (skippedSize.has(rel)) return 'skipped-size';
        if (skippedLines.has(rel)) return 'skipped-lines';
        if (skippedDenylist.has(rel)) return 'skipped-denylist';
        if (parseErrors.has(rel)) return 'error';
        return 'parsed';
    };

    const nextFiles: Record<string, ManifestEntry> = {};
    // Carry forward manifest entries OUTSIDE this subtree untouched so a
    // subtree-scoped refresh never drops the rest of the workspace's
    // fingerprints.
    const bounded =
        subtreePrefix === '' || subtreePrefix === '.'
            ? null
            : subtreePrefix.endsWith('/')
              ? subtreePrefix
              : subtreePrefix + '/';
    const underSubtree = (p: string): boolean => {
        if (bounded === null) return true;
        const norm = p.replace(/\\/g, '/');
        return norm === subtreePrefix || norm.startsWith(bounded);
    };
    for (const [p, entry] of Object.entries(manifest.files)) {
        if (!underSubtree(p)) nextFiles[p] = entry;
    }
    for (const [rel, st] of Object.entries(fsStats)) {
        nextFiles[rel] = {
            mtimeMs: st.mtimeMs,
            size: st.size,
            // The line count is not threaded back per-file from the scan;
            // record 0 (this field is informational and never drives freshness).
            lines: 0,
            status: statusFor(rel),
            // Prefer the freshly computed hash (new/changed files we hashed
            // above); else carry forward the prior entry's hash (warm files we
            // did NOT read). New files now gain a hash on the cold scan, so a
            // later touch-without-edit on them stays WARM.
            hash: st.hash ?? manifest.files[rel]?.hash,
        };
    }
    const nextManifest: Manifest = { version: manifest.version, files: nextFiles };

    // scanFolderRecursive already saved the stores after parsing; persist the
    // manifest (atomic) to close the freshness loop.
    await writeManifest(ctx, nextManifest);

    return coverage;
}
