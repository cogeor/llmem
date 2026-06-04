/**
 * PC-03 — heuristic-call caveat injected into the folder_info prompt via
 * ScanCoverage.heuristicCallGraph.
 *
 * When a documented folder contains Python files (whose call graph is
 * HEURISTIC), the prompt must carry a one-line caveat so the LLM does not read
 * missing Python call edges as "loose coupling". Pure-TS/semantic folders get
 * NO caveat (no noise).
 *
 * Grammar-FREE: the flag is set by EXTENSION, so these drive the pure render
 * helper directly with a synthetic ScanCoverage — no scan, no tree-sitter.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    renderHeuristicCallCaveat,
    HEURISTIC_CALL_CAVEAT,
} from '../../../src/application/coverage-caveat';
import type { ScanCoverage } from '../../../src/application/scan';

function coverage(over: Partial<ScanCoverage> = {}): ScanCoverage {
    return {
        skippedSize: [],
        skippedLines: [],
        skippedDenylist: [],
        parseErrors: [],
        ...over,
    };
}

test('the pinned caveat sentence is the expected wording', () => {
    assert.equal(
        HEURISTIC_CALL_CAVEAT,
        'Call edges for Python are heuristic (name-matched, may miss dynamic dispatch); ' +
            'absence of a call edge is not evidence of no call.',
    );
});

test('emits the caveat when heuristicCallGraph is true', () => {
    const out = renderHeuristicCallCaveat(coverage({ heuristicCallGraph: true }));
    assert.equal(out, HEURISTIC_CALL_CAVEAT);
    assert.match(out, /absence of a call edge is not evidence of no call/);
});

test('emits nothing when heuristicCallGraph is false', () => {
    assert.equal(renderHeuristicCallCaveat(coverage({ heuristicCallGraph: false })), '');
});

test('emits nothing when heuristicCallGraph is absent', () => {
    assert.equal(renderHeuristicCallCaveat(coverage()), '');
});

test('emits nothing when coverage itself is undefined', () => {
    assert.equal(renderHeuristicCallCaveat(undefined), '');
});
