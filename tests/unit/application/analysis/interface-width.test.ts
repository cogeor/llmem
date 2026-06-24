// tests/unit/application/analysis/interface-width.test.ts
//
// Loop 02 — pure-function tests for the interface-width analyzer.
//
// Tests the PURE `interfaceWidthFromGraph(callGraph, importGraph)` directly
// with hand-built in-memory graphs (no IO, no build), mirroring
// metrics.test.ts's ie/g fixture pattern. node:test style.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ImportGraph,
    ImportEdge,
    CallGraph,
    CallEdge,
    EntityNode,
} from '../../../../src/graph/types';
import { interfaceWidthFromGraph } from '../../../../src/application/analysis/interface-width';

// ---- fixture helpers ------------------------------------------------------

// import-edge literal with the required ImportEdge fields.
const ie = (source: string, target: string): ImportEdge =>
    ({ source, target, kind: 'import', specifiers: [] });

// file-node import graph (matches metrics.test.ts g helper).
const ig = (ids: string[], edges: ImportEdge[]): ImportGraph => ({
    nodes: new Map(
        ids.map(id => [
            id,
            { id, kind: 'file', label: id, path: id, language: 'unknown' },
        ]),
    ),
    edges,
});

// call-edge literal with required CallEdge fields.
const ce = (source: string, target: string): CallEdge =>
    ({ source, target, kind: 'call', callSiteId: `${source}->${target}` });

// entity id convention: `<fileId>::<name>`.
const entId = (fileId: string, name: string): string => `${fileId}::${name}`;

// call graph from a list of {fileId, name} entities + call edges.
const cg = (
    entities: { fileId: string; name: string }[],
    edges: CallEdge[],
): CallGraph => {
    const nodes = new Map<string, EntityNode>();
    for (const { fileId, name } of entities) {
        const id = entId(fileId, name);
        nodes.set(id, { id, kind: 'function', label: name, fileId });
    }
    return { nodes, edges, unresolved: [] };
};

// empty call graph (for import-only width cases — no entities needed for W1/W2).
const emptyCg = (): CallGraph => ({ nodes: new Map(), edges: [], unresolved: [] });

const find = (
    findings: ReturnType<typeof interfaceWidthFromGraph>,
    id: string,
) => findings.find(f => f.id === id);

// ---- Case 1: W_eff ≈ 1 (one dominant door — THE logger fix) ---------------

test('W_eff ≈ 1: eight importers all hit one entry file ⇒ w=1, wEff=1', () => {
    const importers = Array.from({ length: 8 }, (_, n) => `src/c${n}.ts`);
    const importGraph = ig(
        ['src/m/a.ts', 'src/m/b.ts', ...importers],
        importers.map(c => ie(c, 'src/m/a.ts')), // all 8 → a.ts, none → b.ts
    );
    const findings = interfaceWidthFromGraph(emptyCg(), importGraph);

    const folder = find(findings, 'iw:folder:src/m');
    assert.ok(folder, 'src/m folder finding exists');
    assert.equal(folder.w, 1, 'one external entry point (a.ts)');
    assert.ok(Math.abs(folder.wEff - 1) < 1e-9, 'wEff is 1 (one dominant door)');
    assert.equal(folder.topEntryPoints[0].entity, 'src/m/a.ts');
    assert.equal(folder.topEntryPoints[0].inbound, 8);
});

// ---- Case 2: W_eff ≈ 8 (eight even doors) ---------------------------------

test('W_eff ≈ 8: eight even doors ⇒ w=8, wEff=8', () => {
    const files = Array.from({ length: 8 }, (_, n) => `src/n/d${n}.ts`);
    const importers = Array.from({ length: 8 }, (_, n) => `src/imp${n}.ts`);
    const importGraph = ig(
        ['src/n/x.ts', ...files, ...importers], // x.ts present so src/n exists even if unused
        files.map((f, n) => ie(importers[n], f)), // one inbound edge each, distinct doors
    );
    const findings = interfaceWidthFromGraph(emptyCg(), importGraph);

    const folder = find(findings, 'iw:folder:src/n');
    assert.ok(folder, 'src/n folder finding exists');
    assert.equal(folder.w, 8, 'eight distinct external entry points');
    assert.ok(Math.abs(folder.wEff - 8) < 1e-9, 'wEff is 8 (eight even doors)');
});

// ---- Case 3: DMR ordering (deep-narrow > shallow-wide) --------------------

test('DMR ordering: deep-narrow folder outranks shallow-wide folder', () => {
    // deep/: w=1 (single entry) but 10 entities in subtree.
    // shallow/: w=6 (even) but 2 entities in subtree.
    const deepImporters = Array.from({ length: 5 }, (_, n) => `src/di${n}.ts`);
    const shallowImporters = Array.from({ length: 6 }, (_, n) => `src/si${n}.ts`);
    const shallowFiles = ['src/shallow/s0.ts', 'src/shallow/s1.ts',
        'src/shallow/s2.ts', 'src/shallow/s3.ts', 'src/shallow/s4.ts', 'src/shallow/s5.ts'];

    const importGraph = ig(
        ['src/deep/entry.ts', ...shallowFiles, ...deepImporters, ...shallowImporters],
        [
            ...deepImporters.map(d => ie(d, 'src/deep/entry.ts')), // w(deep)=1
            ...shallowImporters.map((s, n) => ie(s, shallowFiles[n])), // w(shallow)=6 even
        ],
    );

    // deep/ subtree = 10 entities; shallow/ subtree = 2 entities.
    const deepEntities = Array.from({ length: 10 }, (_, n) => ({
        fileId: 'src/deep/entry.ts',
        name: `fn${n}`,
    }));
    const shallowEntities = [
        { fileId: 'src/shallow/s0.ts', name: 'a' },
        { fileId: 'src/shallow/s1.ts', name: 'b' },
    ];
    const callGraph = cg([...deepEntities, ...shallowEntities], []);

    const findings = interfaceWidthFromGraph(callGraph, importGraph);
    const deep = find(findings, 'iw:folder:src/deep');
    const shallow = find(findings, 'iw:folder:src/shallow');
    assert.ok(deep, 'deep folder finding exists');
    assert.ok(shallow, 'shallow folder finding exists');
    assert.equal(deep.moduleDepth, 10, 'deep subtree counts 10 entities');
    assert.equal(shallow.moduleDepth, 2, 'shallow subtree counts 2 entities');
    assert.ok(deep.dmr > shallow.dmr, 'deep-narrow DMR > shallow-wide DMR');
});

// ---- Case 4: folder aggregates subtree (external is relative to level) -----

test('folder external-is-relative: edge internal to a level is not counted there', () => {
    // src/p/edge-list/x.ts imports y.ts (internal to edge-list/);
    // src/p/outside.ts imports edge-list/x.ts (external to edge-list/, internal to p/).
    const importGraph = ig(
        [
            'src/p/edge-list/x.ts',
            'src/p/edge-list/y.ts',
            'src/p/outside.ts',
        ],
        [
            ie('src/p/edge-list/x.ts', 'src/p/edge-list/y.ts'), // internal to edge-list/
            ie('src/p/outside.ts', 'src/p/edge-list/x.ts'), // crosses edge-list/ boundary
        ],
    );
    const findings = interfaceWidthFromGraph(emptyCg(), importGraph);

    const edgeList = find(findings, 'iw:folder:src/p/edge-list');
    assert.ok(edgeList, 'edge-list folder finding exists');
    assert.equal(edgeList.w, 1, 'only outside→x crosses the edge-list boundary');
    assert.equal(edgeList.topEntryPoints[0].entity, 'src/p/edge-list/x.ts');
    assert.equal(edgeList.topEntryPoints[0].inbound, 1);

    const p = find(findings, 'iw:folder:src/p');
    assert.ok(p, 'src/p folder finding exists');
    assert.equal(p.w, 0, 'both edges are internal to src/p ⇒ no boundary crossing');
});

// ---- Case 5: tree-depth tagging (src/=0 convention) -----------------------

test('tree-depth: src/=0 convention pinned (folder and file inherit dir depth)', () => {
    const importGraph = ig(
        ['src/p/edge-list/x.ts', 'src/p/edge-list/y.ts', 'src/p/outside.ts'],
        [
            ie('src/p/edge-list/x.ts', 'src/p/edge-list/y.ts'),
            ie('src/p/outside.ts', 'src/p/edge-list/x.ts'),
        ],
    );
    const findings = interfaceWidthFromGraph(emptyCg(), importGraph);

    assert.equal(find(findings, 'iw:folder:src/p')!.treeDepth, 1, 'src/p depth 1');
    assert.equal(
        find(findings, 'iw:folder:src/p/edge-list')!.treeDepth,
        2,
        'src/p/edge-list depth 2',
    );
    assert.equal(
        find(findings, 'iw:file:src/p/edge-list/x.ts')!.treeDepth,
        2,
        'file inherits its directory depth (2)',
    );
});

// ---- Case 6: function-scope width (call substrate) ------------------------

test('function-scope: cross-file caller counts, same-file caller does not', () => {
    const fooId = entId('src/q/a.ts', 'foo');
    const callGraph = cg(
        [
            { fileId: 'src/q/a.ts', name: 'foo' },
            { fileId: 'src/q/b.ts', name: 'bar' }, // cross-file caller
            { fileId: 'src/q/a.ts', name: 'baz' }, // same-file caller (excluded)
        ],
        [
            ce(entId('src/q/b.ts', 'bar'), fooId), // cross-file ⇒ counts
            ce(entId('src/q/a.ts', 'baz'), fooId), // same-file ⇒ excluded
        ],
    );
    // import graph only needs the files to exist as nodes.
    const importGraph = ig(['src/q/a.ts', 'src/q/b.ts'], []);

    const findings = interfaceWidthFromGraph(callGraph, importGraph);
    const fn = find(findings, 'iw:fn:' + fooId);
    assert.ok(fn, 'function-scope finding for foo exists');
    assert.equal(fn.scope, 'function');
    assert.equal(fn.w, 1, 'one external (cross-file) entry');
    assert.equal(fn.topEntryPoints[0].inbound, 1, 'inbound count is 1 (same-file excluded)');
    assert.equal(fn.topEntryPoints[0].entity, fooId);
});

// ---- Case 7: determinism ---------------------------------------------------

test('determinism: byte-stable across runs and ids sorted ascending', () => {
    const importGraph = ig(
        ['src/z/a.ts', 'src/z/b.ts', 'src/imp0.ts', 'src/imp1.ts'],
        [ie('src/imp0.ts', 'src/z/a.ts'), ie('src/imp1.ts', 'src/z/b.ts')],
    );
    const callGraph = cg(
        [
            { fileId: 'src/z/a.ts', name: 'f' },
            { fileId: 'src/z/b.ts', name: 'g' },
        ],
        [ce(entId('src/z/b.ts', 'g'), entId('src/z/a.ts', 'f'))],
    );

    const run1 = interfaceWidthFromGraph(callGraph, importGraph);
    const run2 = interfaceWidthFromGraph(callGraph, importGraph);
    assert.equal(
        JSON.stringify(run1),
        JSON.stringify(run2),
        'JSON.stringify byte-stable across runs',
    );

    const ids = run1.map(f => f.id);
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(ids, sorted, 'findings sorted by id ascending');
});
