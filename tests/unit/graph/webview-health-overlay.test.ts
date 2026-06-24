// tests/unit/graph/webview-health-overlay.test.ts
//
// Loop 08 — producer-level coverage for the health-overlay fold.
//
// Mirrors scc-payload.test.ts: drive the PUBLIC
// `prepareWebviewDataFromSplitEdgeLists` with hand-built EdgeListData PLUS a
// plain `HealthOverlay`, and assert the prepared payload:
//   - ADDS a NEW `isClone` VisEdge for a clone pair whose BOTH endpoints are
//     rendered call nodes (CORRECTION 1: clone edges are new edges, not
//     annotations on existing call edges);
//   - DROPS a clone edge whose endpoint is NOT a rendered call node
//     (endpoint-presence guard);
//   - copies `nodeSmells` onto the matching VisNode.smells;
//   - leaves everything undefined when the `health` arg is omitted (regression
//     guard for the existing byte-identical no-health path).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { prepareWebviewDataFromSplitEdgeLists } from '../../../src/graph/webview-data';
import {
    EDGELIST_SCHEMA_VERSION,
    EDGELIST_RESOLVER_VERSION,
} from '../../../src/graph/edgelist-schema';
import type { EdgeListData } from '../../../src/graph/edgelist';
import type { HealthOverlay } from '../../../src/contracts/webview-payloads';

function fileNode(id: string) {
    return { id, name: id.split('/').pop() ?? id, kind: 'file' as const, fileId: id };
}

function buildFixtures() {
    const importData: EdgeListData = {
        schemaVersion: EDGELIST_SCHEMA_VERSION,
        resolverVersion: EDGELIST_RESOLVER_VERSION,
        timestamp: new Date().toISOString(),
        nodes: [fileNode('src/a.ts'), fileNode('src/b.ts')],
        edges: [{ source: 'src/a.ts', target: 'src/b.ts', kind: 'import' }],
    };

    // Two entities in the call graph + one ordinary call edge between them.
    const callData: EdgeListData = {
        schemaVersion: EDGELIST_SCHEMA_VERSION,
        resolverVersion: EDGELIST_RESOLVER_VERSION,
        timestamp: new Date().toISOString(),
        nodes: [
            { id: 'src/a.ts#fn1', name: 'fn1', kind: 'function', fileId: 'src/a.ts', callGraph: 'semantic' },
            { id: 'src/b.ts#fn2', name: 'fn2', kind: 'function', fileId: 'src/b.ts', callGraph: 'semantic' },
        ],
        edges: [
            { source: 'src/a.ts#fn1', target: 'src/b.ts#fn2', kind: 'call' },
        ],
    };

    return { importData, callData };
}

test('health-overlay: clone pair with both endpoints present ADDS a new isClone VisEdge', () => {
    const { importData, callData } = buildFixtures();

    const health: HealthOverlay = {
        // both endpoints are rendered call nodes -> KEPT as a new edge.
        cloneEdges: [
            { source: 'src/a.ts#fn1', target: 'src/b.ts#fn2', severity: 'high' },
        ],
        nodeSmells: {},
    };

    const data = prepareWebviewDataFromSplitEdgeLists(importData, callData, undefined, health);
    const callEdges = data.callGraph.edges;

    // The original (non-clone) call edge is still present and NOT a clone.
    const ordinary = callEdges.find(
        (e) => e.from === 'src/a.ts#fn1' && e.to === 'src/b.ts#fn2' && !e.isClone,
    );
    assert.ok(ordinary, 'the original call edge is preserved');
    assert.strictEqual(ordinary.isClone, undefined, 'original call edge is not a clone');

    // A SEPARATE, NEW clone edge was added with the same endpoints.
    const cloneEdge = callEdges.find((e) => e.isClone === true);
    assert.ok(cloneEdge, 'a new isClone VisEdge was added');
    assert.strictEqual(cloneEdge.from, 'src/a.ts#fn1');
    assert.strictEqual(cloneEdge.to, 'src/b.ts#fn2');
    assert.strictEqual(cloneEdge.cloneSeverity, 'high', 'clone severity carried through');

    // Exactly one clone edge kept.
    assert.strictEqual(
        callEdges.filter((e) => e.isClone === true).length,
        1,
        'exactly one clone edge kept',
    );
});

test('health-overlay: clone pair with a MISSING endpoint is dropped (endpoint-presence guard)', () => {
    const { importData, callData } = buildFixtures();

    const health: HealthOverlay = {
        cloneEdges: [
            // target is NOT a rendered call node -> DROPPED.
            { source: 'src/a.ts#fn1', target: 'src/ghost.ts#nope', severity: 'medium' },
        ],
        nodeSmells: {},
    };

    const data = prepareWebviewDataFromSplitEdgeLists(importData, callData, undefined, health);

    assert.strictEqual(
        data.callGraph.edges.filter((e) => e.isClone === true).length,
        0,
        'a clone edge with a missing endpoint is dropped',
    );
});

test('health-overlay: nodeSmells are copied onto VisNode.smells (import + call)', () => {
    const { importData, callData } = buildFixtures();

    const health: HealthOverlay = {
        cloneEdges: [],
        nodeSmells: {
            'src/a.ts': [{ kind: 'hub', severity: 'medium', title: '5 in / 6 out' }],
            'src/b.ts#fn2': [{ kind: 'clone', severity: 'high', title: 'clone (exact-body)' }],
        },
    };

    const data = prepareWebviewDataFromSplitEdgeLists(importData, callData, undefined, health);

    const importNode = data.importGraph.nodes.find((n) => n.id === 'src/a.ts');
    assert.ok(importNode, 'import node present');
    assert.ok(importNode.smells, 'import node carries smells');
    assert.strictEqual(importNode.smells![0].kind, 'hub');
    assert.strictEqual(importNode.smells![0].severity, 'medium');
    assert.strictEqual(importNode.smells![0].title, '5 in / 6 out');

    const callNode = data.callGraph.nodes.find((n) => n.id === 'src/b.ts#fn2');
    assert.ok(callNode, 'call node present');
    assert.ok(callNode.smells, 'call node carries smells');
    assert.strictEqual(callNode.smells![0].kind, 'clone');
    assert.strictEqual(callNode.smells![0].severity, 'high');

    // A node with no smell entry stays undefined.
    const cleanNode = data.callGraph.nodes.find((n) => n.id === 'src/a.ts#fn1');
    assert.ok(cleanNode, 'clean call node present');
    assert.strictEqual(cleanNode.smells, undefined, 'non-smelly node has undefined smells');
});

test('health-overlay: omitting the health arg leaves all overlay fields undefined (regression guard)', () => {
    const { importData, callData } = buildFixtures();

    const data = prepareWebviewDataFromSplitEdgeLists(importData, callData);

    // No clone edges added.
    for (const e of data.callGraph.edges) {
        assert.strictEqual(e.isClone, undefined, 'no isClone edges without health');
        assert.strictEqual(e.cloneSeverity, undefined, 'no cloneSeverity without health');
    }
    // No node smells.
    for (const n of [...data.importGraph.nodes, ...data.callGraph.nodes]) {
        assert.strictEqual(n.smells, undefined, 'no smells without health');
    }
});
