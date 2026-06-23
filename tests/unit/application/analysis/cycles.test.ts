// tests/unit/application/analysis/cycles.test.ts
//
// Loop 01 — pure-function tests for the import-cycle analyzer.
//
// Tests the PURE `importCyclesFromGraph(importGraph)` directly with an
// in-memory `ImportGraph` (no IO, no build), mirroring
// tests/unit/cli/find-cycles.test.ts. node:test style.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ImportGraph, ImportEdge } from '../../../../src/graph/types';
import { importCyclesFromGraph } from '../../../../src/application/analysis/cycles';

// import-edge literal with the required ImportEdge fields.
const ie = (source: string, target: string): ImportEdge =>
    ({ source, target, kind: 'import', specifiers: [] });

// build an ImportGraph from explicit ids + edges (file nodes; ids are POSIX).
const g = (ids: string[], edges: ImportEdge[]): ImportGraph => ({
    nodes: new Map(
        ids.map(id => [
            id,
            { id, kind: 'file', label: id, path: id, language: 'unknown' },
        ]),
    ),
    edges,
});

test('importCyclesFromGraph: a<->b cycle yields one finding with both members and a closed path', () => {
    const graph = g(
        ['src/a.ts', 'src/b.ts'],
        [ie('src/a.ts', 'src/b.ts'), ie('src/b.ts', 'src/a.ts')],
    );
    const findings = importCyclesFromGraph(graph);

    assert.equal(findings.length, 1, 'exactly one cycle finding');
    assert.deepEqual(
        findings[0].members,
        ['src/a.ts', 'src/b.ts'],
        'members are the sorted SCC node ids',
    );
    assert.equal(findings[0].type, 'import-cycle');
    assert.equal(findings[0].kind, 'import-cycle');

    // shortestPath is CLOSED (first === last) and names both members.
    const sp = findings[0].shortestPath;
    assert.equal(sp[0], sp.at(-1), 'path is closed');
    assert.deepEqual(sp, ['src/a.ts', 'src/b.ts', 'src/a.ts']);
});

test('importCyclesFromGraph: acyclic graph yields no findings', () => {
    const graph = g(
        ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        [ie('src/a.ts', 'src/b.ts'), ie('src/b.ts', 'src/c.ts')],
    );
    assert.equal(importCyclesFromGraph(graph).length, 0);
});
