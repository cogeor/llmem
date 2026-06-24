// tests/unit/graph/webview-call-incycle.test.ts
//
// Loop 04 — producer-level coverage for the call-edge `inCycle` payload flag.
//
// Mirrors scc-payload.test.ts: drive the PUBLIC
// `prepareWebviewDataFromSplitEdgeLists` end-to-end and assert that call-cycle
// edges get `inCycle:true`, acyclic call edges stay undefined, and import
// behavior is unchanged.
//
// CRITICAL fixture notes:
// - Entity id separator is `::` (makeEntityId), NOT `#`.
// - Call nodes MUST carry `callGraph:'semantic'` or buildGraphsFromSplitEdgeLists
//   drops them (callGraph:'none' node filter).
// - Envelope schemaVersion is the imported constant (resolves to 4), never a
//   hardcoded literal.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { prepareWebviewDataFromSplitEdgeLists } from '../../../src/graph/webview-data';
import {
    EDGELIST_SCHEMA_VERSION,
    EDGELIST_RESOLVER_VERSION,
} from '../../../src/graph/edgelist-schema';
import type { EdgeListData } from '../../../src/graph/edgelist';
import { makeEntityId } from '../../../src/core/ids';

function fileNode(id: string) {
    return { id, name: id.split('/').pop() ?? id, kind: 'file' as const, fileId: id };
}

test('webview-call-incycle: cyclic call edges carry inCycle:true, acyclic ones undefined, imports unchanged', () => {
    const importData: EdgeListData = {
        schemaVersion: EDGELIST_SCHEMA_VERSION,
        resolverVersion: EDGELIST_RESOLVER_VERSION,
        timestamp: new Date().toISOString(),
        nodes: [
            fileNode('src/a.ts'),
            fileNode('src/b.ts'),
            fileNode('src/c.ts'),
        ],
        edges: [
            // 2-node import cycle a <-> b
            { source: 'src/a.ts', target: 'src/b.ts', kind: 'import' },
            { source: 'src/b.ts', target: 'src/a.ts', kind: 'import' },
            // acyclic tail b -> c
            { source: 'src/b.ts', target: 'src/c.ts', kind: 'import' },
        ],
    };

    const f = makeEntityId('src/a.ts', 'f'); // 'src/a.ts::f'
    const g = makeEntityId('src/a.ts', 'g');
    const h = makeEntityId('src/a.ts', 'h');

    const callData: EdgeListData = {
        schemaVersion: EDGELIST_SCHEMA_VERSION,
        resolverVersion: EDGELIST_RESOLVER_VERSION,
        timestamp: new Date().toISOString(),
        nodes: [
            { id: f, name: 'f', kind: 'function', fileId: 'src/a.ts', callGraph: 'semantic' },
            { id: g, name: 'g', kind: 'function', fileId: 'src/a.ts', callGraph: 'semantic' },
            { id: h, name: 'h', kind: 'function', fileId: 'src/a.ts', callGraph: 'semantic' },
        ],
        edges: [
            { source: f, target: g, kind: 'call' }, // cycle
            { source: g, target: f, kind: 'call' }, // cycle
            { source: g, target: h, kind: 'call' }, // acyclic tail
        ],
    };

    const data = prepareWebviewDataFromSplitEdgeLists(importData, callData);

    const cFind = (from: string, to: string) =>
        data.callGraph.edges.find((e) => e.from === from && e.to === to);
    const fg = cFind(f, g);
    const gf = cFind(g, f);
    const gh = cFind(g, h);
    assert.ok(fg, 'f->g call edge present');
    assert.ok(gf, 'g->f call edge present');
    assert.ok(gh, 'g->h call edge present');
    assert.strictEqual(fg.inCycle, true, 'cyclic call edge f->g is inCycle:true');
    assert.strictEqual(gf.inCycle, true, 'cyclic call edge g->f is inCycle:true');
    assert.strictEqual(gh.inCycle, undefined, 'acyclic call edge g->h omits inCycle');

    // import behavior UNCHANGED: a<->b tagged, tail not.
    const iFind = (from: string, to: string) =>
        data.importGraph.edges.find((e) => e.from === from && e.to === to);
    assert.strictEqual(iFind('src/a.ts', 'src/b.ts')?.inCycle, true);
    assert.strictEqual(iFind('src/b.ts', 'src/a.ts')?.inCycle, true);
    assert.strictEqual(iFind('src/b.ts', 'src/c.ts')?.inCycle, undefined);
});
