// tests/unit/graph/call-dangling.test.ts
//
// Loop PC-01 — §8 grammar-FREE coverage of the honesty-critical drop.
//
// PythonExtractor now emits CallSite[] with calleeName = the FINAL identifier
// and resolvedDefinition UNDEFINED, so the converter's tier-3 resolver keys
// makeEntityId(fileId, calleeName) — a BARE entity name. When no such entity
// exists in the file (e.g. self.method() with no sibling `method` def, or
// getattr(o,'x')() emitting a spurious 'x'), the tier-3 edge points at a node
// that was never created. The graph builder's both-endpoints filter
// (src/graph/index.ts: callNodes.has(source) && callNodes.has(target)) DROPS
// such dangling edges at build time — no spurious node, no spurious edge.
//
// This validates that drop synthetically (NO tree-sitter): we construct
// Entity[] by hand, run them through artifactToEdgeList + the graph build, and
// assert the dangling tier-3 edge is filtered while a real intra-file edge
// survives.
//
// NOTE: a `.ts` fileId is used here only because it has a call-graph capability
// (semantic). The honesty path under test (the language-agnostic both-endpoints
// filter) is identical for any populated `calls`. (Language-gate coverage — that
// .py participates and .c does not — lives in call-graph-languages.test.ts.)

import test from 'node:test';
import assert from 'node:assert/strict';

import { artifactToEdgeList } from '../../../src/application/artifact-converter';
import { buildGraphsFromSplitEdgeLists } from '../../../src/graph/index';
import { createEmptyEdgeList, EdgeListData } from '../../../src/graph/edgelist-schema';
import { makeEntityId } from '../../../src/core/ids';
import type { FileArtifact, Loc } from '../../../src/parser/types';

const LOC: Loc = {
    startByte: 0,
    endByte: 0,
    startLine: 1,
    endLine: 1,
    startColumn: 0,
    endColumn: 0,
};

function buildCallGraphFromArtifact(artifact: FileArtifact, fileId: string) {
    const { nodes, callEdges } = artifactToEdgeList(artifact, fileId);
    const callData: EdgeListData = { ...createEmptyEdgeList(), nodes, edges: callEdges };
    const importData = createEmptyEdgeList();
    return buildGraphsFromSplitEdgeLists(importData, callData);
}

test('call-dangling: a tier-3 CallSite to a NON-existent entity produces NO node and NO edge', () => {
    const fileId = 'x.ts';
    // Entity 'a' calls 'method', but there is NO entity named 'method' in the
    // file. The converter emits a tier-3 edge a -> x.ts::method; the builder
    // must drop it (target node never created).
    const artifact: FileArtifact = {
        schemaVersion: 'test-v1',
        file: { id: fileId, path: fileId, language: 'typescript' },
        imports: [],
        exports: [],
        entities: [
            {
                id: 'a-0',
                kind: 'function',
                name: 'a',
                isExported: true,
                loc: LOC,
                calls: [
                    { callSiteId: 'method@0', kind: 'method', calleeName: 'method', loc: LOC },
                ],
            },
        ],
    };

    const { callGraph } = buildCallGraphFromArtifact(artifact, fileId);

    const danglingTarget = makeEntityId(fileId, 'method');
    assert.equal(callGraph.nodes.has(danglingTarget), false, 'no spurious node for missing callee');
    assert.equal(
        callGraph.edges.some((e) => e.target === danglingTarget),
        false,
        'dangling tier-3 edge must be dropped at graph-build',
    );
    // Only the real 'a' node should exist.
    assert.ok(callGraph.nodes.has(makeEntityId(fileId, 'a')), 'real entity node a present');
    assert.equal(callGraph.edges.length, 0, 'no call edges survive');
});

test('call-dangling: a tier-3 CallSite to an EXISTING sibling entity SURVIVES (a -> b)', () => {
    const fileId = 'x.ts';
    // Entities 'a' and 'b' in the same file; 'a' calls 'b'. Both endpoints are
    // real nodes, so the edge survives.
    const artifact: FileArtifact = {
        schemaVersion: 'test-v1',
        file: { id: fileId, path: fileId, language: 'typescript' },
        imports: [],
        exports: [],
        entities: [
            {
                id: 'a-0',
                kind: 'function',
                name: 'a',
                isExported: true,
                loc: LOC,
                calls: [
                    { callSiteId: 'b@0', kind: 'function', calleeName: 'b', loc: LOC },
                ],
            },
            {
                id: 'b-0',
                kind: 'function',
                name: 'b',
                isExported: true,
                loc: LOC,
                calls: [],
            },
        ],
    };

    const { callGraph } = buildCallGraphFromArtifact(artifact, fileId);

    const aId = makeEntityId(fileId, 'a');
    const bId = makeEntityId(fileId, 'b');
    assert.ok(callGraph.nodes.has(aId), 'node a present');
    assert.ok(callGraph.nodes.has(bId), 'node b present');
    const ab = callGraph.edges.find((e) => e.source === aId && e.target === bId);
    assert.ok(ab, `expected surviving call edge ${aId} -> ${bId}`);
});
