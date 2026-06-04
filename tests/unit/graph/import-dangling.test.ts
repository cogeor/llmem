// tests/unit/graph/import-dangling.test.ts
//
// Loop LS-07 — import-edge DANGLING-NODE FILTER in the graph builder.
//
// Before LS-07, buildGraphsFromSplitEdgeLists synthesized a phantom file-node
// for ANY import-edge endpoint, so a deleted file with INCOMING imports still
// rendered as a node + a dangling edge. The builder now mirrors the call
// graph's both-endpoints filter: an import edge survives only when each
// endpoint is a real file-node (present in importData.nodes) OR an external
// module. A non-external endpoint with no file-node is a deleted/phantom file
// and is dropped — no synthesized node, no dangling edge.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    EdgeListData,
    createEmptyEdgeList,
} from '../../../src/graph/edgelist-schema';
import { buildGraphsFromSplitEdgeLists } from '../../../src/graph/index';

test('import-dangling: a deleted TARGET with an incoming import produces NO phantom node and NO dangling edge', () => {
    // a.ts still imports b.ts, but b.ts was deleted — its file node was purged
    // (removeByFile), leaving only the inbound edge IF removal missed it. Even
    // if such a stale edge survives in the persisted store, the build filter
    // must NOT render b.ts as a node and must drop the edge.
    const importData: EdgeListData = {
        ...createEmptyEdgeList(),
        nodes: [
            { id: 'src/a.ts', name: 'a.ts', kind: 'file', fileId: 'src/a.ts' },
            // NOTE: src/b.ts has NO node entry — it was deleted.
        ],
        edges: [
            { source: 'src/a.ts', target: 'src/b.ts', kind: 'import' },
        ],
    };
    const callData = createEmptyEdgeList();

    const { importGraph } = buildGraphsFromSplitEdgeLists(importData, callData);

    assert.equal(importGraph.nodes.has('src/b.ts'), false, 'no phantom node for deleted target');
    assert.equal(importGraph.nodes.size, 1, 'only the real a.ts node remains');
    assert.ok(importGraph.nodes.has('src/a.ts'));
    assert.equal(importGraph.edges.length, 0, 'dangling edge to deleted file must be dropped');
});

test('import-dangling: a real edge to an EXISTING file survives the filter', () => {
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
    const { importGraph } = buildGraphsFromSplitEdgeLists(importData, createEmptyEdgeList());

    assert.equal(importGraph.nodes.size, 2);
    assert.equal(importGraph.edges.length, 1);
    assert.equal(importGraph.edges[0].target, 'src/b.ts');
});

test('import-dangling: external-module targets are PRESERVED (not treated as dangling)', () => {
    const importData: EdgeListData = {
        ...createEmptyEdgeList(),
        nodes: [
            { id: 'src/a.ts', name: 'a.ts', kind: 'file', fileId: 'src/a.ts' },
        ],
        edges: [
            { source: 'src/a.ts', target: 'react', kind: 'import' },
            { source: 'src/a.ts', target: 'lodash', kind: 'import' },
            // dangling: src/gone.ts has no node and is not external → dropped.
            { source: 'src/a.ts', target: 'src/gone.ts', kind: 'import' },
        ],
    };
    const { importGraph } = buildGraphsFromSplitEdgeLists(importData, createEmptyEdgeList());

    assert.ok(importGraph.nodes.has('react'), 'external node preserved');
    assert.ok(importGraph.nodes.has('lodash'), 'external node preserved');
    assert.equal(importGraph.nodes.has('src/gone.ts'), false, 'phantom file node dropped');
    assert.equal(importGraph.edges.length, 2, 'two external edges kept, one dangling dropped');
    assert.ok(importGraph.edges.every(e => e.target === 'react' || e.target === 'lodash'));
});
