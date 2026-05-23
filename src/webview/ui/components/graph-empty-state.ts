/**
 * Pure predicate + message constant for the Graph pane's empty-state
 * overlay. Decoupled from DOM and AppState so the truth table is
 * unit-testable without jsdom or a bundler. See Loop 05.
 *
 * Shown when: the scan produced at least one import-graph node AND the
 * user has not yet watched any path. As soon as `watchedPaths` is
 * non-empty (file OR folder entries both count), the overlay hides.
 */

export const EMPTY_STATE_MESSAGE =
    'Toggle a file in the explorer (left) to add it to the graph.';

export function shouldShowGraphEmptyState(
    importNodeCount: number,
    watchedPaths: ReadonlySet<string>,
): boolean {
    return importNodeCount > 0 && watchedPaths.size === 0;
}
