// tests/unit/graph/scc.test.ts
//
// Loop 01 — SCC engine over ImportGraph (Tarjan + barrel/aggregator exclusion).
//
// Pins the behaviour of `src/graph/scc.ts`: deterministic iterative Tarjan,
// the self-loop-aware non-trivial selector, the aggregator predicate +
// exclusion, and the consumer-facing in-cycle helpers (computed on the
// POST-exclusion graph). shortestCyclePath is DEFERRED to Loop 03 and is not
// tested here.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ImportGraph, ImportEdge } from '../../../src/graph/types';
import {
    tarjanSccs,
    nonTrivialSccs,
    isAggregatorNode,
    excludeAggregatorEdges,
    computeInCycleEdgeKeys,
    edgeInCycle,
    shortestCyclePath,
} from '../../../src/graph/scc';

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

test('scc: acyclic graph has no non-trivial SCCs and edgeInCycle is false everywhere', () => {
    const graph = g(
        ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        [ie('src/a.ts', 'src/b.ts'), ie('src/b.ts', 'src/c.ts')],
    );
    assert.equal(nonTrivialSccs(graph).length, 0);
    assert.equal(computeInCycleEdgeKeys(graph).size, 0);
    assert.equal(edgeInCycle(graph)('src/a.ts', 'src/b.ts'), false);
    assert.equal(edgeInCycle(graph)('src/b.ts', 'src/c.ts'), false);
});

test('scc: simple 2-node cycle A->B->A is one SCC {A,B} with both edges in cycle', () => {
    const graph = g(
        ['src/a.ts', 'src/b.ts'],
        [ie('src/a.ts', 'src/b.ts'), ie('src/b.ts', 'src/a.ts')],
    );
    assert.deepEqual(nonTrivialSccs(graph), [['src/a.ts', 'src/b.ts']]);

    const keys = computeInCycleEdgeKeys(graph);
    assert.deepEqual(
        [...keys].sort(),
        ['src/a.ts->src/b.ts', 'src/b.ts->src/a.ts'],
    );
    assert.equal(edgeInCycle(graph)('src/a.ts', 'src/b.ts'), true);
    assert.equal(edgeInCycle(graph)('src/b.ts', 'src/a.ts'), true);
});

test('scc: 3-node cycle with a dangling acyclic tail tags only the cycle edges', () => {
    const graph = g(
        ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts'],
        [
            ie('src/a.ts', 'src/b.ts'),
            ie('src/b.ts', 'src/c.ts'),
            ie('src/c.ts', 'src/a.ts'),
            // acyclic tail off the cycle
            ie('src/c.ts', 'src/d.ts'),
            ie('src/d.ts', 'src/e.ts'),
        ],
    );
    assert.deepEqual(nonTrivialSccs(graph), [
        ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    ]);

    const keys = computeInCycleEdgeKeys(graph);
    assert.deepEqual(
        [...keys].sort(),
        ['src/a.ts->src/b.ts', 'src/b.ts->src/c.ts', 'src/c.ts->src/a.ts'],
    );
    assert.equal(keys.has('src/c.ts->src/d.ts'), false);
    assert.equal(keys.has('src/d.ts->src/e.ts'), false);
});

test('scc: a self-loop A->A counts as a non-trivial (cyclic) SCC', () => {
    const graph = g(['src/a.ts'], [ie('src/a.ts', 'src/a.ts')]);
    assert.deepEqual(nonTrivialSccs(graph), [['src/a.ts']]);

    const keys = computeInCycleEdgeKeys(graph);
    assert.deepEqual([...keys], ['src/a.ts->src/a.ts']);
    assert.equal(edgeInCycle(graph)('src/a.ts', 'src/a.ts'), true);
});

test('scc: component ordering and membership are deterministic across runs', () => {
    // Nodes inserted OUT of sorted order, with two disjoint 2-cycles.
    const graph = g(
        ['src/z.ts', 'src/y.ts', 'src/m.ts', 'src/n.ts'],
        [
            ie('src/z.ts', 'src/y.ts'),
            ie('src/y.ts', 'src/z.ts'),
            ie('src/m.ts', 'src/n.ts'),
            ie('src/n.ts', 'src/m.ts'),
        ],
    );
    const first = tarjanSccs(graph);
    const second = tarjanSccs(graph);

    // stable across runs
    assert.deepEqual(first, second);
    // ordered by smallest id: {m,n} before {y,z}; each component sorted
    assert.deepEqual(first, [
        ['src/m.ts', 'src/n.ts'],
        ['src/y.ts', 'src/z.ts'],
    ]);
});

test('scc: barrel/aggregator exclusion drops index-touching edges before detection', () => {
    // A -> index -> B -> A. The cycle only closes THROUGH the aggregator, so
    // after exclusion there is no cycle left.
    const graph = g(
        ['src/a.ts', 'src/index.ts', 'src/b.ts'],
        [
            ie('src/a.ts', 'src/index.ts'),
            ie('src/index.ts', 'src/b.ts'),
            ie('src/b.ts', 'src/a.ts'),
        ],
    );

    assert.equal(isAggregatorNode('src/index.ts'), true);
    assert.equal(isAggregatorNode('src/a.ts'), false);

    const excluded = excludeAggregatorEdges(graph);
    // both index-touching edges dropped; only B->A survives; all 3 nodes kept.
    assert.equal(excluded.edges.length, 1);
    assert.equal(excluded.edges[0].source, 'src/b.ts');
    assert.equal(excluded.edges[0].target, 'src/a.ts');
    assert.equal(excluded.nodes.size, 3);

    // post-exclusion the remaining B->A is not a cycle (no path back).
    assert.equal(computeInCycleEdgeKeys(graph).size, 0);

    // Python aggregator sibling.
    assert.equal(isAggregatorNode('pkg/sub/__init__.py'), true);
    assert.equal(isAggregatorNode('pkg/sub/mod.py'), false);
});

test('scc: edgeInCycle delegates to computeInCycleEdgeKeys (same membership)', () => {
    const graph = g(
        ['src/a.ts', 'src/b.ts'],
        [ie('src/a.ts', 'src/b.ts'), ie('src/b.ts', 'src/a.ts')],
    );
    const keys = computeInCycleEdgeKeys(graph);
    assert.ok(keys instanceof Set);

    const pred = edgeInCycle(graph);
    // both helpers agree for a cyclic edge and a non-existent edge.
    assert.equal(pred('src/a.ts', 'src/b.ts'), keys.has('src/a.ts->src/b.ts'));
    assert.equal(pred('src/a.ts', 'src/zzz.ts'), keys.has('src/a.ts->src/zzz.ts'));
    assert.equal(pred('src/a.ts', 'src/b.ts'), true);
});

test('shortestCyclePath: 2-node cycle returns closed a->b->a from smallest id', () => {
    const graph = g(
        ['src/a.ts', 'src/b.ts'],
        [ie('src/a.ts', 'src/b.ts'), ie('src/b.ts', 'src/a.ts')],
    );
    const hops = shortestCyclePath(graph, ['src/a.ts', 'src/b.ts']);
    assert.equal(hops.length, 2);
    // closed chain start (smallest id 'a') -> b -> a.
    assert.deepEqual(
        [hops[0].source, ...hops.map(h => h.target)],
        ['src/a.ts', 'src/b.ts', 'src/a.ts'],
    );
});

test('shortestCyclePath: size-1 self-loop returns the single self-edge', () => {
    const selfEdge = ie('src/a.ts', 'src/a.ts');
    const graph = g(['src/a.ts'], [selfEdge]);
    const hops = shortestCyclePath(graph, ['src/a.ts']);
    assert.equal(hops.length, 1);
    assert.equal(hops[0].source, 'src/a.ts');
    assert.equal(hops[0].target, 'src/a.ts');
});

test('shortestCyclePath: size-1 non-self-loop / acyclic returns []', () => {
    // lone node with no self-loop.
    const graph = g(['src/a.ts'], []);
    assert.deepEqual(shortestCyclePath(graph, ['src/a.ts']), []);
});

test('shortestCyclePath: 3-node cycle returns closed a->b->c->a', () => {
    const graph = g(
        ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
        [
            ie('src/a.ts', 'src/b.ts'),
            ie('src/b.ts', 'src/c.ts'),
            ie('src/c.ts', 'src/a.ts'),
            ie('src/c.ts', 'src/d.ts'), // dangling tail, must not appear
        ],
    );
    const hops = shortestCyclePath(graph, ['src/a.ts', 'src/b.ts', 'src/c.ts']);
    assert.deepEqual(
        [hops[0].source, ...hops.map(h => h.target)],
        ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/a.ts'],
    );
});

test('shortestCyclePath: deterministic across repeated calls', () => {
    const graph = g(
        ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        [
            ie('src/a.ts', 'src/b.ts'),
            ie('src/b.ts', 'src/c.ts'),
            ie('src/c.ts', 'src/a.ts'),
        ],
    );
    const scc = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
    assert.deepEqual(shortestCyclePath(graph, scc), shortestCyclePath(graph, scc));
});
