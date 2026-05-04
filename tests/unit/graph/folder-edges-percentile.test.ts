// tests/unit/graph/folder-edges-percentile.test.ts
//
// Loop 08 — pin the 90th-percentile contract directly.
//
// `computeWeightP90` uses NumPy's default linear-interpolation method
// (type 7 / Excel `PERCENTILE.INC`):
//
//     rank = 0.9 * (n - 1)
//     lo = floor(rank), hi = ceil(rank)
//     return sorted[lo] + (rank - lo) * (sorted[hi] - sorted[lo])
//
// Each fixture below pins the exact expected number.

import test from 'node:test';
import assert from 'node:assert/strict';

import { computeWeightP90 } from '../../../src/graph/folder-edges';

const EPS = 1e-9;

test('computeWeightP90: empty array returns 0', () => {
    assert.equal(computeWeightP90([]), 0);
});

test('computeWeightP90: single element returns that element', () => {
    assert.equal(computeWeightP90([5]), 5);
});

test('computeWeightP90: uniform input returns the uniform value', () => {
    assert.equal(computeWeightP90([3, 3, 3, 3, 3]), 3);
});

test('computeWeightP90: 1..10 returns 9.1 (rank 0.9*9 = 8.1)', () => {
    const result = computeWeightP90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.ok(Math.abs(result - 9.1) < EPS, `expected ~9.1, got ${result}`);
});

test('computeWeightP90: [1,2,3] returns 2.8 (rank 0.9*2 = 1.8)', () => {
    const result = computeWeightP90([1, 2, 3]);
    assert.ok(Math.abs(result - 2.8) < EPS, `expected ~2.8, got ${result}`);
});

test('computeWeightP90: 1..100 returns 90.1 (rank 0.9*99 = 89.1)', () => {
    const weights = Array.from({ length: 100 }, (_, i) => i + 1);
    const result = computeWeightP90(weights);
    assert.ok(Math.abs(result - 90.1) < EPS, `expected ~90.1, got ${result}`);
});

test('computeWeightP90: two-element [1, 10] returns 9.1 (rank 0.9)', () => {
    const result = computeWeightP90([1, 10]);
    assert.ok(Math.abs(result - 9.1) < EPS, `expected ~9.1, got ${result}`);
});

test('computeWeightP90: unsorted input does not mutate the caller array', () => {
    const original = [10, 1, 5, 3, 7];
    const snapshot = original.slice();
    const result = computeWeightP90(original);
    assert.deepEqual(original, snapshot, 'caller array was mutated');
    // Sanity: sorted is [1,3,5,7,10]; rank 0.9*4 = 3.6 → sorted[3] + 0.6*(sorted[4]-sorted[3]) = 7 + 0.6*3 = 8.8
    assert.ok(Math.abs(result - 8.8) < EPS, `expected ~8.8, got ${result}`);
});
