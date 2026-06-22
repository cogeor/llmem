// tests/unit/graph/scc-payload.test.ts
//
// Loop 02 — producer-level coverage for the `inCycle` payload flag.
//
// EdgeRenderer is browser DOM with no `node --test` harness, so the automated
// coverage for the cycle-detection feature lives here at the producer level:
// drive the PUBLIC `prepareWebviewDataFromSplitEdgeLists` end-to-end (it calls
// buildGraphsFromSplitEdgeLists -> transformGraphsToVisData) with hand-built
// EdgeListData and assert the resulting VisEdge flags.
//
// Fixture: a<->b cycle plus an acyclic b->c->d tail (no aggregator basenames),
// every endpoint backed by a real file-node so the dangling filter keeps them.
// A semantic call-edge fixture confirms call edges are NEVER tagged.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { prepareWebviewDataFromSplitEdgeLists } from '../../../src/graph/webview-data';
import {
    EDGELIST_SCHEMA_VERSION,
    EDGELIST_RESOLVER_VERSION,
} from '../../../src/graph/edgelist-schema';
import type { EdgeListData } from '../../../src/graph/edgelist';

function fileNode(id: string) {
    return { id, name: id.split('/').pop() ?? id, kind: 'file' as const, fileId: id };
}

test('scc-payload: cyclic import edges carry inCycle:true, acyclic ones undefined, call edges never tagged', () => {
    const importData: EdgeListData = {
        schemaVersion: EDGELIST_SCHEMA_VERSION,
        resolverVersion: EDGELIST_RESOLVER_VERSION,
        timestamp: new Date().toISOString(),
        nodes: [
            fileNode('src/a.ts'),
            fileNode('src/b.ts'),
            fileNode('src/c.ts'),
            fileNode('src/d.ts'),
        ],
        edges: [
            // 2-node cycle a <-> b
            { source: 'src/a.ts', target: 'src/b.ts', kind: 'import' },
            { source: 'src/b.ts', target: 'src/a.ts', kind: 'import' },
            // acyclic tail b -> c -> d
            { source: 'src/b.ts', target: 'src/c.ts', kind: 'import' },
            { source: 'src/c.ts', target: 'src/d.ts', kind: 'import' },
        ],
    };

    // Call graph: two semantic function nodes in a.ts with one call edge.
    const callData: EdgeListData = {
        schemaVersion: EDGELIST_SCHEMA_VERSION,
        resolverVersion: EDGELIST_RESOLVER_VERSION,
        timestamp: new Date().toISOString(),
        nodes: [
            { id: 'src/a.ts#fn1', name: 'fn1', kind: 'function', fileId: 'src/a.ts', callGraph: 'semantic' },
            { id: 'src/a.ts#fn2', name: 'fn2', kind: 'function', fileId: 'src/a.ts', callGraph: 'semantic' },
        ],
        edges: [
            { source: 'src/a.ts#fn1', target: 'src/a.ts#fn2', kind: 'call' },
        ],
    };

    const data = prepareWebviewDataFromSplitEdgeLists(importData, callData);

    const importEdges = data.importGraph.edges;
    const find = (from: string, to: string) =>
        importEdges.find((e) => e.from === from && e.to === to);

    const ab = find('src/a.ts', 'src/b.ts');
    const ba = find('src/b.ts', 'src/a.ts');
    assert.ok(ab, 'a->b edge present');
    assert.ok(ba, 'b->a edge present');
    assert.strictEqual(ab.inCycle, true, 'cyclic edge a->b is inCycle:true');
    assert.strictEqual(ba.inCycle, true, 'cyclic edge b->a is inCycle:true');

    const bc = find('src/b.ts', 'src/c.ts');
    const cd = find('src/c.ts', 'src/d.ts');
    assert.ok(bc, 'b->c edge present');
    assert.ok(cd, 'c->d edge present');
    assert.strictEqual(bc.inCycle, undefined, 'acyclic edge b->c omits inCycle');
    assert.strictEqual(cd.inCycle, undefined, 'acyclic edge c->d omits inCycle');

    // Exactly two in-cycle import edges — guards the exclusion pass / key format.
    const cycleCount = importEdges.filter((e) => e.inCycle === true).length;
    assert.strictEqual(cycleCount, 2, 'exactly the two cycle edges are tagged');

    // No call edge ever carries inCycle.
    assert.ok(data.callGraph.edges.length > 0, 'call fixture wired (>=1 call edge)');
    for (const e of data.callGraph.edges) {
        assert.strictEqual(e.inCycle, undefined, 'call edges never carry inCycle');
    }
});
