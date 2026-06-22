/**
 * On-demand graph refresh — the single-FILE path (LS-08).
 *
 * Single-file analogue of `refreshFolderGraph`. See `./folder.ts` for the
 * shared composition (scan-manifest fingerprints, LS-07 removeByFile, LS-10
 * atomic save) and `./shared.ts` for the `emptyCoverage` helper both paths use.
 */

import * as path from 'path';
import { ImportEdgeListStore, CallEdgeListStore } from '../../graph/edgelist';
import { ParserRegistry } from '../../parser/registry';
import { type ScanCoverage } from '../scan';
import { classifyScanCandidate } from '../scan/candidate';
import { runParser } from '../scan/parser-runner';
import { applyArtifactToStores } from '../scan/edge-writer';
import {
    readManifest,
    writeManifest,
    type Manifest,
    type ManifestStatus,
} from '../scan-manifest';
import type { WorkspaceContext } from '../workspace-context';
import { emptyCoverage } from './shared';

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
            internalOnly: ctx.config.internalOnly,
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
