/**
 * `ensureGraph` — shared zero-config auto-scan for graph-consuming commands.
 *
 * Extracted from `serve.ts` (A5, 2026-07-13): `health`, `review`, and
 * `find-cycles` used to hard-fail with "Please scan workspace first." when no
 * edge lists existed, while `serve` silently indexed on first run. Now every
 * graph consumer gets the same zero-config behavior through this one helper
 * (extracting rather than copying — a copy would be exactly the clone smell
 * the health report flags).
 *
 * The probe uses the RESOLVED `ctx.artifactRoot` (absolute; may live
 * outside the workspace) — the old guards called `hasEdgeLists(workspace)`
 * with the DEFAULT root, so a custom `LLMEM_ARTIFACT_ROOT` made them
 * demand a rescan of an already-scanned workspace (review bug 1.3).
 *
 * CLI layer: `console.log` is allowed here (tests/arch/console-discipline).
 */

import { hasEdgeLists } from '../../viewer-generator';
import { scanFolderRecursive, formatUnsupportedSourceHints } from '../../application/scan';
import type { WorkspaceContext } from '../../application/workspace-context';
import { CliError } from '../errors';
import { createScanProgress } from '../progress';

export interface EnsureGraphResult {
    /** True when a first-run scan was performed (edge lists were missing). */
    scanned: boolean;
    /** Files indexed by that scan; 0 when `scanned` is false. */
    filesProcessed: number;
}

/**
 * Ensure the workspace has edge lists, scanning once if missing.
 *
 * With `requireGraph`, a scan that still yields no edge lists throws a
 * `CliError` (exit 1) — the posture of `health`/`review`/`find-cycles`,
 * which cannot produce a report without a graph. `serve` omits it and
 * starts with an empty graph instead.
 */
export async function ensureGraph(
    ctx: WorkspaceContext,
    opts: { requireGraph?: boolean } = {},
): Promise<EnsureGraphResult> {
    if (hasEdgeLists(ctx.artifactRoot)) {
        return { scanned: false, filesProcessed: 0 };
    }

    console.log('Indexing workspace... (first run)');
    // B3: live progress (overwriting TTY line / CI dots via the onFile seam).
    const progress = createScanProgress();
    const result = await scanFolderRecursive(ctx, {
        folderPath: '.',
        onFile: progress.onFile,
    });
    progress.finish();
    console.log(
        `Indexed ${result.filesProcessed} files ` +
        `(${result.filesSkipped} skipped, ${result.errors.length} errors).`,
    );
    // Surface skipped-language counts so users know which peer grammars to
    // install. Zero lines when no allowlist files were silently dropped.
    for (const line of formatUnsupportedSourceHints(result.unsupportedSourceLikeCounts)) {
        console.log(line);
    }

    if (opts.requireGraph && !hasEdgeLists(ctx.artifactRoot)) {
        throw new CliError(
            "Error: Scan produced no edge lists — run 'llmem scan' to see why.",
            1,
        );
    }

    return { scanned: true, filesProcessed: result.filesProcessed };
}
