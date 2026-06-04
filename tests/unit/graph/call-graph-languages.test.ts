// tests/unit/graph/call-graph-languages.test.ts
//
// PC plan-gap fix — the call graph is no longer TypeScript-only at build.
//
// PythonExtractor now populates Entity.calls (PC-01), but the graph builder
// previously gated call-NODE creation on isTypeScriptFile(node.fileId), so
// Python call entities were silently dropped at build and never reached the
// viewer — making the whole heuristic-call-graph feature dead. The builder now
// gates on getCallGraphCapability(fileId) !== 'none' (derived from the LANGUAGES
// descriptor): 'semantic' (TS/JS) and 'heuristic' (Python) participate; 'none'
// (C/C++/Rust/R, unknown) are excluded.
//
// Grammar-FREE: synthetic Entity[] through artifactToEdgeList + the graph build.

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

function siblingCallArtifact(fileId: string, language: string): FileArtifact {
    // Entities 'a' and 'b' in one file; 'a' calls sibling 'b'.
    return {
        schemaVersion: 'test-v1',
        file: { id: fileId, path: fileId, language },
        imports: [],
        exports: [],
        entities: [
            {
                id: 'a-0',
                kind: 'function',
                name: 'a',
                isExported: true,
                loc: LOC,
                calls: [{ callSiteId: 'b@0', kind: 'function', calleeName: 'b', loc: LOC }],
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
}

function buildCallGraph(fileId: string, language: string) {
    const { nodes, callEdges } = artifactToEdgeList(siblingCallArtifact(fileId, language), fileId);
    const callData: EdgeListData = { ...createEmptyEdgeList(), nodes, edges: callEdges };
    return buildGraphsFromSplitEdgeLists(createEmptyEdgeList(), callData).callGraph;
}

test('call-graph-languages: Python (.py, heuristic) call nodes + edges now build', () => {
    const fileId = 'pkg/mod.py';
    const callGraph = buildCallGraph(fileId, 'python');

    const aId = makeEntityId(fileId, 'a');
    const bId = makeEntityId(fileId, 'b');
    assert.ok(callGraph.nodes.has(aId), 'Python entity node a must be in the call graph');
    assert.ok(callGraph.nodes.has(bId), 'Python entity node b must be in the call graph');
    assert.ok(
        callGraph.edges.find((e) => e.source === aId && e.target === bId),
        'Python heuristic call edge a -> b must survive the build',
    );
});

test('call-graph-languages: TypeScript (.ts, semantic) still builds', () => {
    const fileId = 'src/mod.ts';
    const callGraph = buildCallGraph(fileId, 'typescript');
    assert.ok(callGraph.nodes.has(makeEntityId(fileId, 'a')), 'TS entity node a present');
    assert.ok(
        callGraph.edges.length >= 1,
        'TS call edge survives',
    );
});

test('call-graph-languages (PC-04): Python (.py) call node carries callGraph "heuristic"', () => {
    const fileId = 'pkg/mod.py';
    const callGraph = buildCallGraph(fileId, 'python');
    const node = callGraph.nodes.get(makeEntityId(fileId, 'a'));
    assert.ok(node, 'Python entity node a must be present');
    assert.equal(node!.callGraph, 'heuristic', 'Python node must be baked as heuristic for the viewer badge');
});

test('call-graph-languages (PC-04): TypeScript (.ts) call node carries callGraph "semantic" (unbadged)', () => {
    const fileId = 'src/mod.ts';
    const callGraph = buildCallGraph(fileId, 'typescript');
    const node = callGraph.nodes.get(makeEntityId(fileId, 'a'));
    assert.ok(node, 'TS entity node a must be present');
    assert.equal(node!.callGraph, 'semantic', 'TS node is semantic — viewer leaves it unbadged');
});

test('call-graph-languages: C (.c, callGraph none) is excluded from the call graph', () => {
    const fileId = 'src/mod.c';
    const callGraph = buildCallGraph(fileId, 'c');
    assert.equal(callGraph.nodes.size, 0, 'C files have no call-graph capability — no nodes');
    assert.equal(callGraph.edges.length, 0, 'C files contribute no call edges');
});
