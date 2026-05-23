// tests/unit/web-viewer/graph-empty-state.test.ts
//
// Loop 05 — pin the truth table for the Graph pane's empty-state
// overlay predicate. The function is pure (no DOM, no AppState
// dependency), so this suite skips the jsdom harness that the other
// web-viewer tests use and goes straight to `require()` against the
// source via ts-node/register (configured by scripts/run-tests.cjs).
//
// The overlay shows precisely when: scan produced > 0 import nodes
// AND watchedPaths is empty. As soon as ANY path (file or folder) is
// in watchedPaths, the overlay hides.

import test from 'node:test';
import assert from 'node:assert/strict';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { shouldShowGraphEmptyState, EMPTY_STATE_MESSAGE } = require(
    '../../../src/webview/ui/components/graph-empty-state',
) as {
    shouldShowGraphEmptyState: (
        importNodeCount: number,
        watchedPaths: ReadonlySet<string>,
    ) => boolean;
    EMPTY_STATE_MESSAGE: string;
};

test('shouldShowGraphEmptyState: 0 nodes, 0 watched -> false (no scan data)', () => {
    assert.equal(shouldShowGraphEmptyState(0, new Set()), false);
});

test('shouldShowGraphEmptyState: 5 nodes, 0 watched -> true (target case)', () => {
    assert.equal(shouldShowGraphEmptyState(5, new Set()), true);
});

test('shouldShowGraphEmptyState: 5 nodes, 1 watched file -> false', () => {
    assert.equal(
        shouldShowGraphEmptyState(5, new Set(['src/foo.ts'])),
        false,
    );
});

test('shouldShowGraphEmptyState: 5 nodes, 1 watched folder path -> false', () => {
    // Folder entries in watchedPaths still count as "watched" — the
    // predicate only fires when the set is strictly empty.
    assert.equal(
        shouldShowGraphEmptyState(5, new Set(['src/foo'])),
        false,
    );
});

test('shouldShowGraphEmptyState: 0 nodes, 1 watched -> false (degenerate, defensive)', () => {
    assert.equal(
        shouldShowGraphEmptyState(0, new Set(['src/foo.ts'])),
        false,
    );
});

test('EMPTY_STATE_MESSAGE: contains the canonical instruction wording', () => {
    // Lock the user-visible string at the predicate boundary so any
    // copy change has to land in the test as well.
    assert.ok(
        EMPTY_STATE_MESSAGE.includes('Toggle a file'),
        `expected message to contain "Toggle a file"; got: ${EMPTY_STATE_MESSAGE}`,
    );
});
