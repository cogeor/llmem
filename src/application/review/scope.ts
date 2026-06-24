/**
 * Review-scope helpers (WS-2, pure).
 *
 * A review is requested over a single `path` — a file id or a folder prefix.
 * These three pure functions answer "what granularity is this review?" and
 * "does this candidate live under the reviewed subtree?" — the geometry the
 * recall pass (`recall.ts`) uses to attach graph findings to checklist items.
 *
 * `scope` here governs candidate-computation GRANULARITY, not item inclusion:
 * the checklist always carries every registry item in the selected ruleset (the
 * no-skip device). A folder review still surfaces file-scope hits for files in
 * the subtree — see PLAN 02 design decision.
 *
 * Determinism: no `Date` / `Math.random`; pure string operations only.
 */

import type { ImportGraph } from '../../graph/types';
import type { ItemScope } from './types';

/**
 * Normalize a review path to the graph's id convention: backslashes → forward
 * slashes, trim a single trailing slash (so `src/webview/` and `src/webview`
 * are the same subtree), and trim surrounding whitespace. Idempotent.
 */
export function normalizeReviewPath(path: string): string {
    let p = path.trim().replace(/\\/g, '/');
    // Drop a trailing slash (but never reduce the path to empty).
    while (p.length > 1 && p.endsWith('/')) {
        p = p.slice(0, -1);
    }
    return p;
}

/**
 * Decide the granularity of a review from the GRAPH (no extra IO): if a
 * normalized `path` is an import-graph FILE node id, the review is `'file'`;
 * otherwise it is treated as a `'folder'` prefix.
 *
 * Returns `'file'` or `'folder'` only — `'repo'` is a registry ITEM scope, not
 * a review-path kind (a root review is just a folder whose prefix matches the
 * whole tree).
 */
export function detectPathKind(
    importGraph: ImportGraph,
    path: string,
): Exclude<ItemScope, 'repo'> {
    const normalized = normalizeReviewPath(path);
    const node = importGraph.nodes.get(normalized);
    return node?.kind === 'file' ? 'file' : 'folder';
}

/**
 * Is `candidatePath` under the reviewed `reviewPath`?
 *
 *  - `pathKind === 'file'`: exact id match only (a file review's subtree is the
 *    file itself).
 *  - `pathKind === 'folder'`: the candidate equals the folder prefix OR sits
 *    beneath it (`reviewPath + '/'` prefix). A root review (e.g. `src`) matches
 *    every `src/...` candidate; an empty/`.`-style root matches everything.
 *
 * Both arguments are normalized internally, so callers may pass raw ids.
 */
export function isUnderPath(
    candidatePath: string,
    reviewPath: string,
    pathKind: Exclude<ItemScope, 'repo'>,
): boolean {
    const candidate = normalizeReviewPath(candidatePath);
    const review = normalizeReviewPath(reviewPath);

    if (pathKind === 'file') {
        return candidate === review;
    }

    // Folder review. A whole-tree review ('', '.', '/') matches everything.
    if (review === '' || review === '.' || review === '/') {
        return true;
    }
    return candidate === review || candidate.startsWith(review + '/');
}
