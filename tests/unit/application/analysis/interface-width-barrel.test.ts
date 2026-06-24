// tests/unit/application/analysis/interface-width-barrel.test.ts
//
// Loop 03 — barrel detection + `isBarrel` annotation on file modules.
//
// A barrel is a 0-entity file with ≥1 INBOUND import edge (B1 + B2'). The
// outbound side is unreliable because re-exports are NOT import edges (a pure
// `export…from` barrel has 0 outbound import edges — see analyzer header). So
// the signal is "declares nothing yet is imported = pure conduit". This is a
// PROXY and annotation-only (never gates). Reuses the ie/ig/cg fixture helpers
// from interface-width.test.ts.

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

// ---- fixture helpers (mirrors interface-width.test.ts) --------------------

const ie = (source: string, target: string): ImportEdge =>
    ({ source, target, kind: 'import', specifiers: [] });

const ig = (ids: string[], edges: ImportEdge[]): ImportGraph => ({
    nodes: new Map(
        ids.map(id => [
            id,
            { id, kind: 'file', label: id, path: id, language: 'unknown' },
        ]),
    ),
    edges,
});

const entId = (fileId: string, name: string): string => `${fileId}::${name}`;

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

const emptyCg = (): CallGraph => ({ nodes: new Map(), edges: [], unresolved: [] });

const find = (
    findings: ReturnType<typeof interfaceWidthFromGraph>,
    id: string,
) => findings.find(f => f.id === id);

// ---- Case 1: barrel.ts (0 entities, imported by 3) ⇒ isBarrel true --------

test('barrel proxy: 0-entity file imported by 3 consumers ⇒ isBarrel true', () => {
    const consumers = ['src/b/c0.ts', 'src/b/c1.ts', 'src/b/c2.ts'];
    const importGraph = ig(
        ['src/b/barrel.ts', ...consumers],
        consumers.map(c => ie(c, 'src/b/barrel.ts')), // 3 inbound, 0 outbound
    );
    // barrel.ts declares NO entities (call graph has none for it).
    const findings = interfaceWidthFromGraph(emptyCg(), importGraph);

    const barrel = find(findings, 'iw:file:src/b/barrel.ts');
    assert.ok(barrel, 'barrel.ts file finding exists');
    assert.equal(barrel.isBarrel, true, '0 entities + ≥1 inbound ⇒ isBarrel true');
    // Annotation does NOT change the metrics (no folding).
    assert.equal(barrel.w, 1, 'W unchanged: one entry door (barrel.ts itself)');
    assert.equal(barrel.moduleDepth, 0, 'depth unchanged: 0 own entities');
});

// ---- Case 2: normal 2-entity file imported by others ⇒ isBarrel falsy -----

test('barrel proxy: normal 2-entity file (imported) ⇒ isBarrel falsy', () => {
    const importGraph = ig(
        ['src/b/impl.ts', 'src/b/u0.ts', 'src/b/u1.ts'],
        [ie('src/b/u0.ts', 'src/b/impl.ts'), ie('src/b/u1.ts', 'src/b/impl.ts')],
    );
    const callGraph = cg(
        [
            { fileId: 'src/b/impl.ts', name: 'alpha' },
            { fileId: 'src/b/impl.ts', name: 'beta' },
        ],
        [],
    );
    const findings = interfaceWidthFromGraph(callGraph, importGraph);

    const impl = find(findings, 'iw:file:src/b/impl.ts');
    assert.ok(impl, 'impl.ts file finding exists');
    assert.ok(!impl.isBarrel, 'a file with own entities is NOT a barrel');
    assert.equal(impl.moduleDepth, 2, 'impl.ts has 2 own entities');
    // Only-when-true: the key must be absent, not `false` (JSON stability).
    assert.equal('isBarrel' in impl, false, 'isBarrel key absent when not a barrel');
});

// ---- Case 3: 0-entity orphan with NO inbound ⇒ isBarrel falsy (B2') -------

test('barrel proxy: 0-entity orphan (no inbound) ⇒ isBarrel falsy', () => {
    // orphan.ts declares nothing AND is imported by nobody — fails B2'.
    const importGraph = ig(
        ['src/b/orphan.ts', 'src/b/other.ts', 'src/b/imp.ts'],
        [ie('src/b/imp.ts', 'src/b/other.ts')], // orphan has 0 inbound
    );
    const findings = interfaceWidthFromGraph(emptyCg(), importGraph);

    const orphan = find(findings, 'iw:file:src/b/orphan.ts');
    assert.ok(orphan, 'orphan.ts file finding exists');
    assert.ok(!orphan.isBarrel, '0 entities but 0 inbound ⇒ NOT a barrel (B2 guard)');
    assert.equal('isBarrel' in orphan, false, 'isBarrel key absent for the orphan');
});

// ---- Case 4: determinism re-check (barrel annotation byte-stable) ---------

test('determinism: barrel-annotated findings are JSON byte-stable', () => {
    const consumers = ['src/b/c0.ts', 'src/b/c1.ts', 'src/b/c2.ts'];
    const importGraph = ig(
        ['src/b/barrel.ts', ...consumers],
        consumers.map(c => ie(c, 'src/b/barrel.ts')),
    );
    const run1 = interfaceWidthFromGraph(emptyCg(), importGraph);
    const run2 = interfaceWidthFromGraph(emptyCg(), importGraph);
    assert.equal(
        JSON.stringify(run1),
        JSON.stringify(run2),
        'JSON.stringify byte-stable with isBarrel present',
    );

    const ids = run1.map(f => f.id);
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(ids, sorted, 'findings still sorted by id ascending');
});
