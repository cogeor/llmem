/**
 * Coverage struct helpers, extracted from `application/scan.ts` (loop 07).
 * `emptyCoverage` / `mergeCoverage` were previously private to scan.ts;
 * they are exported here so the on-demand refresh path (loop 08) can reuse
 * the SAME empty-struct shape and merge semantics instead of re-deriving
 * them.
 */

import type { ScanCoverage } from './types';

/** A fresh, empty coverage struct. */
export function emptyCoverage(): ScanCoverage {
    return {
        skippedSize: [],
        skippedLines: [],
        skippedDenylist: [],
        parseErrors: [],
    };
}

/**
 * Merge two coverage structs without dropping entries: concat the path
 * arrays key-by-key, sum `overFileCap` (undefined treated as 0; omitted if
 * the total is 0 so the field stays absent when no cap was surfaced), and
 * concat `parseErrors`. Used by `scanFolderRecursive` to aggregate across
 * subfolders.
 */
export function mergeCoverage(a: ScanCoverage, b: ScanCoverage): ScanCoverage {
    const overFileCap = (a.overFileCap ?? 0) + (b.overFileCap ?? 0);
    const merged: ScanCoverage = {
        skippedSize: [...a.skippedSize, ...b.skippedSize],
        skippedLines: [...a.skippedLines, ...b.skippedLines],
        skippedDenylist: [...a.skippedDenylist, ...b.skippedDenylist],
        parseErrors: [...a.parseErrors, ...b.parseErrors],
    };
    if (overFileCap > 0) merged.overFileCap = overFileCap;
    // OR the heuristic flag across subfolders: any heuristic-call-graph file
    // anywhere in the aggregated subtree sets it.
    if (a.heuristicCallGraph || b.heuristicCallGraph) merged.heuristicCallGraph = true;
    return merged;
}
