// tests/unit/application/analysis/cycle-typeonly.test.ts
//
// Loop 03 (health-analysis) — pin the runtime-vs-type-only import-cycle split.
//
// A cycle whose edges are all `import type` is erased at compile time, so it is
// NOT a runtime cycle: it is still REPORTED (incl-type-only) but its runtime
// core collapses (`runtimeMembers.length < 2`). The health vector's
// `importCyclesInclTypeOnly` counts every reported cycle; `importCyclesRuntime`
// counts only those whose runtime core still has >= 2 members.
//
// These are PURE tests over in-memory ImportGraphs (no IO). The health.ts
// counting expression is replicated inline so the dimension semantics are
// pinned without standing up a WorkspaceContext / on-disk store.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ImportGraph, ImportEdge } from '../../../../src/graph/types';
import { importCyclesFromGraph } from '../../../../src/application/analysis/cycles';
import type { CycleFinding } from '../../../../src/application/analysis/types';

// import-edge literal with the optional `typeOnly` flag.
const ie = (source: string, target: string, typeOnly: boolean): ImportEdge =>
    ({ source, target, kind: 'import', specifiers: [], typeOnly });

const g = (ids: string[], edges: ImportEdge[]): ImportGraph => ({
    nodes: new Map(
        ids.map(id => [
            id,
            { id, kind: 'file', label: id, path: id, language: 'unknown' },
        ]),
    ),
    edges,
});

// Mirrors src/application/analysis/health.ts derivation EXACTLY.
const inclTypeOnly = (findings: CycleFinding[]): number => findings.length;
const runtime = (findings: CycleFinding[]): number =>
    findings.filter(c => (c.runtimeMembers?.length ?? c.members.length) >= 2).length;

test('type-only-only cycle: reported (incl) but runtime core collapses', () => {
    const graph = g(
        ['a.ts', 'b.ts'],
        [ie('a.ts', 'b.ts', true), ie('b.ts', 'a.ts', true)],
    );
    const findings = importCyclesFromGraph(graph);

    assert.equal(findings.length, 1, 'exactly one cycle finding (incl type-only)');
    const f = findings[0];
    assert.deepEqual(f.members, ['a.ts', 'b.ts']);
    assert.equal(f.totalEdgeCount, 2, 'both edges are in-cycle');
    assert.equal(f.typeOnlyEdgeCount, 2, 'both in-cycle edges are type-only');
    assert.equal(f.typeOnlyEdgeCount, f.totalEdgeCount);
    assert.ok(
        (f.runtimeMembers?.length ?? 0) < 2,
        'runtime core collapses (no runtime cycle survives)',
    );

    // Vector derivation: 1 incl-type-only, 0 runtime.
    assert.equal(inclTypeOnly(findings), 1);
    assert.equal(runtime(findings), 0);
});

test('runtime cycle: both dimensions count it', () => {
    const graph = g(
        ['a.ts', 'b.ts'],
        [ie('a.ts', 'b.ts', false), ie('b.ts', 'a.ts', false)],
    );
    const findings = importCyclesFromGraph(graph);

    assert.equal(findings.length, 1);
    const f = findings[0];
    assert.equal(f.typeOnlyEdgeCount, 0, 'no type-only edges');
    assert.equal(f.totalEdgeCount, 2);
    assert.equal(f.runtimeMembers?.length, 2, 'both members survive in the runtime core');

    assert.equal(inclTypeOnly(findings), 1);
    assert.equal(runtime(findings), 1);
});

test('mixed cycle: needs a runtime edge in BOTH directions to be a runtime cycle', () => {
    // a->b type-only, b->a runtime. The single runtime edge cannot close a
    // 2-cycle, so the runtime core collapses.
    const graph = g(
        ['a.ts', 'b.ts'],
        [ie('a.ts', 'b.ts', true), ie('b.ts', 'a.ts', false)],
    );
    const findings = importCyclesFromGraph(graph);

    assert.equal(findings.length, 1, 'still reported as an incl-type-only cycle');
    const f = findings[0];
    assert.equal(f.totalEdgeCount, 2);
    assert.equal(f.typeOnlyEdgeCount, 1);
    assert.ok(
        (f.runtimeMembers?.length ?? 0) < 2,
        'one-directional runtime edge does not close a 2-cycle',
    );

    assert.equal(inclTypeOnly(findings), 1);
    assert.equal(runtime(findings), 0);
});
