/**
 * Coverage / heuristic caveat renderers (LS-04 + PC-03).
 *
 * Pure prompt-fragment renderers shared by both document use cases
 * (`document-file` and `document-folder`). Extracted here so `document-file`
 * no longer reaches into `document-folder` just to reuse the §7 COVERAGE NOTES
 * wording — the two use cases now depend on this small caveat module instead of
 * on each other.
 *
 * No I/O. The wording of every string below is pinned by the unit tests
 * (`tests/unit/application/document-folder-coverage.test.ts`) — keep it stable.
 */

import type { ScanCoverage } from './scan';

// ============================================================================
// renderCoverageCaveat (LS-04)
// ============================================================================

/**
 * Render the §7 "COVERAGE NOTES" caveat block from a {@link ScanCoverage}.
 *
 * Pure render helper — no I/O. Returns `''` when EVERY skip bucket is empty
 * (so callers can append unconditionally and only the non-empty case emits a
 * block). The display-only `overFileCap` and `parseErrors` buckets do NOT
 * trigger the block on their own; this caveat is specifically about files the
 * filter gates dropped from the graph (denylist / size / lines).
 *
 * When non-empty, the block is, in order:
 *   - header:  `## ⚠️ COVERAGE NOTES (graph may be incomplete)`
 *   - one line per skipped file, grouped by reason (size → lines → denylist),
 *     each preserving the per-bucket path order:
 *       size     → `<path> — exceeds size limit (<maxFileSizeKB> KB)`
 *       lines    → `<path> — exceeds line limit (<maxFileLines>)`
 *       denylist → `<path> — generated/declaration file (denylist)`
 *   - trailer: `The summary above is based on the remaining files only.`
 *
 * NOTE: `ScanCoverage.skippedLines` holds paths only (not per-file line
 * counts), so the line reason renders the LIMIT, not the file's count. The
 * wording is pinned by the unit test — keep it stable.
 */
export function renderCoverageCaveat(
    coverage: ScanCoverage,
    cfg: { maxFileSizeKB: number; maxFileLines: number },
): string {
    const { skippedSize, skippedLines, skippedDenylist } = coverage;
    if (
        skippedSize.length === 0 &&
        skippedLines.length === 0 &&
        skippedDenylist.length === 0
    ) {
        return '';
    }

    const lines: string[] = [];
    lines.push('## ⚠️ COVERAGE NOTES (graph may be incomplete)');
    for (const p of skippedSize) {
        lines.push(`${p} — exceeds size limit (${cfg.maxFileSizeKB} KB)`);
    }
    for (const p of skippedLines) {
        lines.push(`${p} — exceeds line limit (${cfg.maxFileLines})`);
    }
    for (const p of skippedDenylist) {
        lines.push(`${p} — generated/declaration file (denylist)`);
    }
    lines.push('The summary above is based on the remaining files only.');

    return lines.join('\n');
}

// ============================================================================
// renderHeuristicCallCaveat (PC-03)
// ============================================================================

/**
 * The one-line caveat injected near the FUNCTION CALLS section when the
 * scanned folder contains heuristic-call-graph (Python) files. Pinned by the
 * unit test — keep stable.
 */
export const HEURISTIC_CALL_CAVEAT =
    'Call edges for Python are heuristic (name-matched, may miss dynamic dispatch); ' +
    'absence of a call edge is not evidence of no call.';

/**
 * Return the heuristic-call caveat line when `coverage.heuristicCallGraph` is
 * true, else `''`. Pure — no I/O. Distinct from {@link renderCoverageCaveat}
 * (the §7 COVERAGE NOTES block for files the filter gates DROPPED); this one
 * is about the call graph being name-matched for Python, and rides near the
 * FUNCTION CALLS section. Both may appear independently. Absent/false coverage
 * → '' (pure-semantic TS/JS folders get no noise).
 */
export function renderHeuristicCallCaveat(coverage?: ScanCoverage): string {
    return coverage?.heuristicCallGraph ? HEURISTIC_CALL_CAVEAT : '';
}
