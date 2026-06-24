// tests/unit/application/analysis/metrics.test.ts
//
// Loop 05 — pure-function tests for the hub / instability analyzer.
//
// Tests the PURE `hubMetricsFromGraph(importGraph)` / `maxFanInFromGraph`
// directly with an in-memory `ImportGraph` (no IO, no build), mirroring
// cycles.test.ts's ie/g fixture pattern. node:test style.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ImportGraph,
    ImportEdge,
    ImportGraphNode,
} from '../../../../src/graph/types';
import {
    hubMetricsFromGraph,
    maxFanInFromGraph,
    HUB_DEGREE_THRESHOLD,
    KERNEL_INSTABILITY_MAX,
} from '../../../../src/application/analysis/metrics';

// import-edge literal with the required ImportEdge fields.
const ie = (source: string, target: string): ImportEdge =>
    ({ source, target, kind: 'import', specifiers: [] });

// file-node graph (matches cycles.test.ts g helper).
const g = (ids: string[], edges: ImportEdge[]): ImportGraph => ({
    nodes: new Map(
        ids.map(id => [
            id,
            { id, kind: 'file', label: id, path: id, language: 'unknown' },
        ]),
    ),
    edges,
});

// graph allowing explicit external nodes alongside file nodes.
const gMixed = (
    nodes: ImportGraphNode[],
    edges: ImportEdge[],
): ImportGraph => ({
    nodes: new Map(nodes.map(n => [n.id, n])),
    edges,
});

const fileNode = (id: string): ImportGraphNode =>
    ({ id, kind: 'file', label: id, path: id, language: 'unknown' });
const extNode = (module: string): ImportGraphNode =>
    ({ id: module, kind: 'external', label: module, module });

test('star ⇒ kernel: hub with fan-in 8 is flagged kernel (ca=8, ce=0, I=0)', () => {
    const leaves = Array.from({ length: 8 }, (_, n) => `src/l${n}.ts`);
    const graph = g(
        ['src/h.ts', ...leaves],
        leaves.map(l => ie(l, 'src/h.ts')),
    );
    const findings = hubMetricsFromGraph(graph);

    assert.equal(findings.length, 1, 'only the hub is flagged (leaves degree 1)');
    const h = findings[0];
    assert.equal(h.relatedFiles[0], 'src/h.ts');
    assert.equal(h.ca, 8);
    assert.equal(h.ce, 0);
    assert.equal(h.instability, 0);
    assert.equal(h.label, 'kernel');
    assert.equal(h.type, 'hub');

    assert.equal(maxFanInFromGraph(graph), 8, 'global max Ca is 8');
});

test('high fan-out / high I ⇒ unstable-hub (ca=1, ce=8, I=8/9)', () => {
    const targets = Array.from({ length: 8 }, (_, n) => `src/t${n}.ts`);
    const graph = g(
        ['src/u.ts', 'src/imp.ts', ...targets],
        [
            ie('src/imp.ts', 'src/u.ts'), // ca(u)=1
            ...targets.map(t => ie('src/u.ts', t)), // ce(u)=8
        ],
    );
    const findings = hubMetricsFromGraph(graph);
    const u = findings.find(f => f.relatedFiles[0] === 'src/u.ts');
    assert.ok(u, 'u.ts is flagged (degree 9)');
    assert.equal(u.ca, 1);
    assert.equal(u.ce, 8);
    assert.equal(u.label, 'unstable-hub');
    assert.ok(Math.abs(u.instability - 8 / 9) < 1e-9, 'I === 8/9');
});

test('I arithmetic: ca=3, ce=5 ⇒ I=5/8=0.625 exactly ⇒ unstable-hub', () => {
    const importers = ['src/i0.ts', 'src/i1.ts', 'src/i2.ts'];
    const targets = ['src/o0.ts', 'src/o1.ts', 'src/o2.ts', 'src/o3.ts', 'src/o4.ts'];
    const graph = g(
        ['src/m.ts', ...importers, ...targets],
        [
            ...importers.map(i => ie(i, 'src/m.ts')), // ca=3
            ...targets.map(t => ie('src/m.ts', t)), // ce=5
        ],
    );
    const m = hubMetricsFromGraph(graph).find(f => f.relatedFiles[0] === 'src/m.ts');
    assert.ok(m, 'm.ts flagged (degree 8)');
    assert.equal(m.ca, 3);
    assert.equal(m.ce, 5);
    assert.equal(m.instability, 5 / 8);
    assert.equal(m.instability, 0.625);
    assert.equal(m.label, 'unstable-hub');
});

test('kernel boundary: ca=6, ce=2 ⇒ I=0.25 ≤ 0.3 ⇒ kernel (label uses I, not degree)', () => {
    const importers = Array.from({ length: 6 }, (_, n) => `src/i${n}.ts`);
    const targets = ['src/o0.ts', 'src/o1.ts'];
    const graph = g(
        ['src/k.ts', ...importers, ...targets],
        [
            ...importers.map(i => ie(i, 'src/k.ts')), // ca=6
            ...targets.map(t => ie('src/k.ts', t)), // ce=2
        ],
    );
    const k = hubMetricsFromGraph(graph).find(f => f.relatedFiles[0] === 'src/k.ts');
    assert.ok(k, 'k.ts flagged (degree 8)');
    assert.equal(k.instability, 0.25);
    assert.ok(k.instability <= KERNEL_INSTABILITY_MAX);
    assert.equal(k.label, 'kernel');
});

test('deterministic order: degree desc, id tie-break asc; byte-stable across runs', () => {
    // two outliers of EQUAL degree 8 (ids aaa/zzz) + one higher (degree 10).
    const aImporters = Array.from({ length: 8 }, (_, n) => `src/ai${n}.ts`);
    const zImporters = Array.from({ length: 8 }, (_, n) => `src/zi${n}.ts`);
    const bImporters = Array.from({ length: 10 }, (_, n) => `src/bi${n}.ts`);
    const graph = g(
        [
            'src/aaa.ts',
            'src/zzz.ts',
            'src/bbb.ts',
            ...aImporters,
            ...zImporters,
            ...bImporters,
        ],
        [
            ...aImporters.map(i => ie(i, 'src/aaa.ts')), // degree 8
            ...zImporters.map(i => ie(i, 'src/zzz.ts')), // degree 8
            ...bImporters.map(i => ie(i, 'src/bbb.ts')), // degree 10
        ],
    );
    const run1 = hubMetricsFromGraph(graph).map(f => f.relatedFiles[0]);
    const run2 = hubMetricsFromGraph(graph).map(f => f.relatedFiles[0]);
    // bbb first (degree 10), then aaa before zzz (equal degree, id asc).
    assert.deepEqual(run1, ['src/bbb.ts', 'src/aaa.ts', 'src/zzz.ts']);
    assert.deepEqual(run1, run2, 'byte-stable ordering');
});

test('external nodes excluded (D1): external imports do not count toward Ce; no external in findings', () => {
    const externals = Array.from({ length: 8 }, (_, n) => `ext${n}`);
    const graph = gMixed(
        [fileNode('src/x.ts'), ...externals.map(extNode)],
        externals.map(e => ie('src/x.ts', e)),
    );
    const findings = hubMetricsFromGraph(graph);
    // x.ts: all 8 edges are to external nodes ⇒ ce=0, degree 0 ⇒ not flagged.
    assert.equal(
        findings.length,
        0,
        'no flagged findings (external edges do not count)',
    );
    assert.ok(
        !findings.some(f => f.relatedFiles[0].startsWith('ext')),
        'no external node ever appears as a finding',
    );
});

test('threshold gate: degree THRESHOLD-1 NOT flagged; degree THRESHOLD IS (>= boundary)', () => {
    const below = HUB_DEGREE_THRESHOLD - 1;
    const belowImporters = Array.from({ length: below }, (_, n) => `src/b${n}.ts`);
    const atImporters = Array.from({ length: HUB_DEGREE_THRESHOLD }, (_, n) => `src/a${n}.ts`);
    const graph = g(
        ['src/below.ts', 'src/at.ts', ...belowImporters, ...atImporters],
        [
            ...belowImporters.map(i => ie(i, 'src/below.ts')), // degree 7
            ...atImporters.map(i => ie(i, 'src/at.ts')), // degree 8
        ],
    );
    const ids = hubMetricsFromGraph(graph).map(f => f.relatedFiles[0]);
    assert.ok(!ids.includes('src/below.ts'), `degree ${below} not flagged`);
    assert.ok(ids.includes('src/at.ts'), `degree ${HUB_DEGREE_THRESHOLD} flagged`);
});
