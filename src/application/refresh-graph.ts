/**
 * On-demand graph refresh (LS-06).
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
 *     coverage WITHOUT any file read / parse / store write. This is the steady
 *     state and must stay stat-only.
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

import * as path from 'path';
import { ImportEdgeListStore, CallEdgeListStore } from '../graph/edgelist';
import { IGNORED_FOLDERS } from '../parser/config';
import { ParserRegistry } from '../parser/registry';
import { scanFolderRecursive, type ScanCoverage } from './scan';
import { classifyScanCandidate } from './scan/candidate';
import { runParser } from './scan/parser-runner';
import { applyArtifactToStores } from './scan/edge-writer';
import {
    readManifest,
    diffManifest,
    writeManifest,
    type Manifest,
    type ManifestEntry,
    type ManifestStatus,
    type FsStat,
} from './scan-manifest';
import type { WorkspaceContext } from './workspace-context';

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

/** A fresh, empty coverage struct (mirrors scan.ts `emptyCoverage`). */
function emptyCoverage(): ScanCoverage {
    return {
        skippedSize: [],
        skippedLines: [],
        skippedDenylist: [],
        parseErrors: [],
    };
}

/**
 * Recursively stat-walk the subtree at `folderPath`, returning a
 * path → {mtimeMs,size} map for every regular FILE found (IGNORED_FOLDERS are
 * pruned, mirroring `scanFolderRecursive`). Stat-only — NO file contents are
 * read, keeping the warm path cheap.
 */
async function walkFsStats(
    ctx: WorkspaceContext,
    folderPath: string,
): Promise<Record<string, FsStat>> {
    const { io } = ctx;
    const out: Record<string, FsStat> = {};

    async function recur(rel: string): Promise<void> {
        const entries = await io.readDir(rel);
        for (const entry of entries) {
            const childRel = path.join(rel, entry).replace(/\\/g, '/');
            const st = await io.stat(childRel);
            if (st.isDirectory()) {
                if (IGNORED_FOLDERS.has(entry)) continue;
                await recur(childRel);
            } else if (st.isFile()) {
                out[childRel] = { mtimeMs: st.mtimeMs, size: st.size };
            }
        }
    }

    await recur(folderPath);
    return out;
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
    await importStore.load();
    await callStore.load();

    // Remove edges for changed + deleted files on BOTH stores. removeByFile
    // (LS-07) is precise to one file and purges edges where the file is the
    // SOURCE *or* the TARGET, so a deleted file with INCOMING imports/calls no
    // longer leaves a stale inbound edge.
    for (const rel of [...diff.changed, ...diff.deleted]) {
        importStore.removeByFile(rel);
        callStore.removeByFile(rel);
    }
    // Persist the removals before the rescan reloads its own store instances
    // (scanFolderRecursive constructs fresh stores and load()s from disk), so
    // deleted files' edges don't survive via a stale on-disk copy.
    await importStore.save();
    await callStore.save();

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
            // record 0 (the diff only compares mtimeMs + size, so this field
            // is informational and never drives freshness).
            lines: 0,
            status: statusFor(rel),
        };
    }
    const nextManifest: Manifest = { version: manifest.version, files: nextFiles };

    // scanFolderRecursive already saved the stores after parsing; persist the
    // manifest (atomic) to close the freshness loop.
    await writeManifest(ctx, nextManifest);

    return coverage;
}

/** Per-call options for {@link refreshFileGraph}. */
export interface RefreshFileGraphOptions {
    /** Workspace-relative file path (forward slashes) to refresh. */
    filePath: string;
    /**
     * `'auto'` (default): bring this one file's edges up to date (warm =
     * stat + manifest compare only; cold/changed = remove + re-gate + parse +
     * manifest rewrite). `'skip'`: no freshness work at all — project the
     * current stores as-is. Mirrors {@link RefreshFolderGraphOptions.refresh}.
     */
    refresh?: 'auto' | 'skip';
}

/**
 * Single-file analogue of {@link refreshFolderGraph} (LS-08). Brings ONE
 * file's edges up to date and returns the {@link ScanCoverage} so the caller
 * (document-file / file_info) can surface a §7 "COVERAGE NOTES" caveat (LS-04)
 * when the file was dropped by a gate.
 *
 * Cheaper than the folder path: it stats and (cold) parses exactly one file —
 * no subtree walk. It shares the SAME gate logic as `scanFolder` by calling
 * the loop-07 `classifyScanCandidate` classifier directly (then `runParser` +
 * `applyArtifactToStores`), rather than routing through `scanFile` — `scanFile`
 * does NOT apply the LS-03 denylist/size/line gates (those live only behind the
 * classifier, which `scanFolder`'s walk also consumes). A single-file refresh
 * must gate so a huge/denylisted file becomes a CAVEAT instead of being parsed.
 *
 * Warm vs cold path (single file)
 * -------------------------------
 *   - 'skip': no stat / read / parse / store write — return empty coverage.
 *   - WARM: the file is present in the manifest with an unchanged mtimeMs+size
 *     → return empty coverage WITHOUT re-parsing. (A previously gate-skipped
 *     file with an unchanged fingerprint stays skipped and emits no fresh
 *     caveat — the live freshness path only re-reports on change, matching the
 *     folder path's warm behavior.)
 *   - COLD / CHANGED (new or fingerprint differs): remove this file's edges on
 *     BOTH stores (removeByFile, LS-07 — purges by SOURCE *and* TARGET),
 *     invalidate the cached parser state, apply the LS-03 gates to the single
 *     file. A gate hit records coverage + a 'skipped-*' manifest status and is
 *     NOT parsed; otherwise parse + addNodes/addEdges. Save both stores
 *     atomically (LS-10) and rewrite the file's manifest entry.
 *
 * DOUBLE-PARSE: document-file still parses inline to build the structural
 * markdown for the prompt; this function parses again to populate the stores.
 * Reconciling (sharing the parsed artifact) is invasive given the inline
 * extract drives the prompt's exact shape, so the second parse is accepted as
 * a perf follow-up — it only happens on the COLD/CHANGED path (warm calls do
 * not re-parse here), so steady-state file_info pays a single parse.
 */
export async function refreshFileGraph(
    ctx: WorkspaceContext,
    opts: RefreshFileGraphOptions,
): Promise<ScanCoverage> {
    const { filePath, refresh = 'auto' } = opts;

    // 'skip' — no freshness work at all.
    if (refresh === 'skip') {
        return emptyCoverage();
    }

    const { io } = ctx;
    const rel = filePath.replace(/\\/g, '/');

    // Stat the single file. A missing file is treated as "nothing to refresh"
    // — document-file's own readFile is the authority on existence and will
    // throw a precise "File not found" before/after this; we must not mask it.
    let st: { mtimeMs: number; size: number };
    try {
        const s = await io.stat(rel);
        if (!s.isFile()) return emptyCoverage();
        st = { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
        return emptyCoverage();
    }

    // Compare this file's fingerprint to its manifest entry. Present +
    // unchanged → WARM (no re-parse). New or changed → COLD/CHANGED.
    const manifest = await readManifest(ctx);
    const prev = manifest.files[rel];
    const unchanged =
        prev !== undefined && prev.mtimeMs === st.mtimeMs && prev.size === st.size;
    if (unchanged) {
        return emptyCoverage();
    }

    // COLD / CHANGED PATH.
    const importStore = new ImportEdgeListStore(ctx.artifactRoot, io);
    const callStore = new CallEdgeListStore(ctx.artifactRoot, io);
    await importStore.load();
    await callStore.load();

    // Remove this file's edges on BOTH stores (LS-07: by source AND target).
    importStore.removeByFile(rel);
    callStore.removeByFile(rel);

    // Drop cached per-workspace parser state so a re-parse after an edit sees
    // the new content (mirrors refreshFolderGraph's cold path).
    ParserRegistry.getInstance().invalidateCaches(ctx.workspaceRoot);

    // --- LS-03 gates via the SHARED loop-07 classifier (the SAME unit
    // `scanFolder`'s walk consumes). Map its decision onto the manifest status
    // + ScanCoverage buckets exactly as the folder walk does, then run the
    // shared parser-runner + edge-writer on the 'parse' path. 'unsupported' is
    // NOT a §7 gate — it stays 'parsed' (no caveat) so the fingerprint advances.
    // `cls.heuristic` (Python) is intentionally NOT ORed in: document-file only
    // renders renderCoverageCaveat (not renderHeuristicCallCaveat) for a
    // refreshFileGraph result, so it would be dead here. The folder path owns it.
    const coverage = emptyCoverage();
    let status: ManifestStatus = 'parsed';

    const basename = path.basename(rel);
    const absoluteFile = path.join(io.getRealRoot(), rel);
    const registry = ParserRegistry.getInstance();

    const cls = classifyScanCandidate({
        rel,
        basename,
        sizeBytes: st.size,
        absPath: absoluteFile,
        config: ctx.config,
        registry,
        workspaceRoot: ctx.workspaceRoot,
    });
    // The manifest `lines` is the counted value iff the line gate ran (supported
    // source); else 0 (denylist/size/unsupported never read the file).
    const lines = cls.lines ?? 0;

    if (cls.decision === 'skipped-denylist') {
        coverage.skippedDenylist.push(rel);
        status = 'skipped-denylist';
    } else if (cls.decision === 'skipped-size') {
        coverage.skippedSize.push(rel);
        status = 'skipped-size';
    } else if (cls.decision === 'skipped-lines') {
        coverage.skippedLines.push(rel);
        status = 'skipped-lines';
    } else if (cls.decision === 'parse') {
        // 'parse' is gated on `registry.isSupported`, so a parser exists and
        // `no-parser` cannot occur. init-error/extract-error → parse-error
        // coverage + 'error'; no-artifact → 'error' (the old `if (!artifact)
        // throw new Error('No artifact extracted')`); ok → shared edge-writer.
        // logProgress:false — a freshness refresh must stay silent (pre-loop-08
        // refreshFileGraph parsed inline without the scan-progress log; the CLI
        // `document` path threads a stdout logger through here, so emitting it
        // would break the positional-vs-`--path` stdout parity).
        const result = await runParser(registry, ctx.logger, {
            rel,
            absPath: absoluteFile,
            workspaceRoot: ctx.workspaceRoot,
            logProgress: false,
        });
        if (result.ok) {
            applyArtifactToStores(result.conversion, callStore, importStore);
        } else if (result.kind === 'init-error' || result.kind === 'extract-error') {
            const e = result.error;
            coverage.parseErrors.push({
                filePath: rel,
                message: e instanceof Error ? e.message : String(e),
                cause: e,
            });
            status = 'error';
        } else if (result.kind === 'no-artifact') {
            coverage.parseErrors.push({ filePath: rel, message: 'No artifact extracted', cause: undefined });
            status = 'error';
        }
    }
    // 'unsupported' → no parser registered: nothing added, no caveat, 'parsed'.

    // Persist removals + any new edges atomically (LS-10).
    await importStore.save();
    await callStore.save();

    // Rewrite ONLY this file's manifest entry; everything else is carried
    // forward untouched.
    const nextManifest: Manifest = {
        version: manifest.version,
        files: { ...manifest.files },
    };
    nextManifest.files[rel] = {
        mtimeMs: st.mtimeMs,
        size: st.size,
        lines,
        status,
    };
    await writeManifest(ctx, nextManifest);

    return coverage;
}
