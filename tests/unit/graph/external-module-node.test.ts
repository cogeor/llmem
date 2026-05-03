// tests/unit/graph/external-module-node.test.ts
//
// Loop 16 — pin the runtime discrimination between workspace file nodes
// and external module nodes in the import graph.
//
// The persisted edge-list shape stays homogenous (every node has
// `kind: 'file' | <entity-kind>`); the workspace-vs-external split is a
// view-time computation done by the graph builder via parseGraphId.
// This test exercises the contract: an edge target whose ID has no slash
// becomes an ExternalModuleNode at runtime, with `kind: 'external'` and
// `module: <id>`. A workspace file ID becomes a FileNode.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    EdgeListData,
    createEmptyEdgeList,
} from '../../../src/graph/edgelist-schema';
import { buildGraphsFromSplitEdgeLists } from '../../../src/graph/index';
import type {
    FileNode,
    ExternalModuleNode,
} from '../../../src/graph/types';

function emptyImportData(): EdgeListData {
    return createEmptyEdgeList();
}

test('external-module-node: workspace file is FileNode, external import target is ExternalModuleNode', () => {
    const importData: EdgeListData = {
        ...createEmptyEdgeList(),
        nodes: [
            { id: 'src/a.ts', name: 'a.ts', kind: 'file', fileId: 'src/a.ts' },
        ],
        edges: [
            { source: 'src/a.ts', target: 'react', kind: 'import' },
        ],
    };
    const callData = createEmptyEdgeList();

    const { importGraph } = buildGraphsFromSplitEdgeLists(importData, callData);

    const aNode = importGraph.nodes.get('src/a.ts');
    assert.ok(aNode, 'src/a.ts node missing');
    assert.equal(aNode!.kind, 'file');
    const file = aNode as FileNode;
    assert.equal(file.path, 'src/a.ts');
    assert.equal(file.language, 'unknown');

    const reactNode = importGraph.nodes.get('react');
    assert.ok(reactNode, 'react node missing');
    assert.equal(reactNode!.kind, 'external');
    const external = reactNode as ExternalModuleNode;
    assert.equal(external.module, 'react');

    assert.equal(importGraph.edges.length, 1);
    assert.equal(importGraph.edges[0].source, 'src/a.ts');
    assert.equal(importGraph.edges[0].target, 'react');
});

test('external-module-node: bare specifier with no slash and no extension is classified external (no regression)', () => {
    const importData: EdgeListData = {
        ...createEmptyEdgeList(),
        nodes: [
            { id: 'src/a.ts', name: 'a.ts', kind: 'file', fileId: 'src/a.ts' },
        ],
        edges: [
            // 'foo' has no slash, no extension — must classify as external.
            { source: 'src/a.ts', target: 'foo', kind: 'import' },
        ],
    };
    const callData = createEmptyEdgeList();
    const { importGraph } = buildGraphsFromSplitEdgeLists(importData, callData);

    const fooNode = importGraph.nodes.get('foo');
    assert.ok(fooNode);
    assert.equal(fooNode!.kind, 'external');
});

test('external-module-node: a path-shaped target stays a FileNode (kind: file)', () => {
    const importData: EdgeListData = {
        ...createEmptyEdgeList(),
        nodes: [
            { id: 'src/a.ts', name: 'a.ts', kind: 'file', fileId: 'src/a.ts' },
            { id: 'src/b.ts', name: 'b.ts', kind: 'file', fileId: 'src/b.ts' },
        ],
        edges: [
            { source: 'src/a.ts', target: 'src/b.ts', kind: 'import' },
        ],
    };
    const callData = createEmptyEdgeList();
    const { importGraph } = buildGraphsFromSplitEdgeLists(importData, callData);

    assert.equal(importGraph.nodes.get('src/b.ts')!.kind, 'file');
});

test('external-module-node: empty import data produces empty graph', () => {
    const { importGraph } = buildGraphsFromSplitEdgeLists(
        emptyImportData(),
        createEmptyEdgeList(),
    );
    assert.equal(importGraph.nodes.size, 0);
    assert.equal(importGraph.edges.length, 0);
});
