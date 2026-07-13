/**
 * D5 (2026-07-13) — the edge-list store getters expose the store's INTERNAL
 * arrays; their return types are readonly so external mutation is a COMPILE
 * error (zero runtime cost — no defensive copies on hot paths). Mutations
 * must go through the store mutators so the dirty flag stays truthful.
 *
 * The compile IS the test: the @ts-expect-error lines below fail the build
 * if someone widens the getters back to mutable arrays. They live in a
 * never-invoked function — readonly is erased at runtime, so executing the
 * mutations would silently corrupt the store instead of throwing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ImportEdgeListStore } from '../../src/graph/edgelist';
import { WorkspaceIO } from '../../src/workspace/workspace-io';
import { asWorkspaceRoot } from '../../src/core/paths';

// Type-level assertions ONLY — never called (see docblock).
function compileTimeReadonlyPins(store: ImportEdgeListStore): void {
    // @ts-expect-error D5 — getNodes() is readonly; use store mutators.
    store.getNodes().push({ id: 'x', name: 'x', kind: 'file', fileId: 'x' });
    // @ts-expect-error D5 — getEdges() is readonly; use store mutators.
    store.getEdges().push({ source: 'a', target: 'b', kind: 'import' });
    // @ts-expect-error D5 — getData() is Readonly; fields cannot be reassigned.
    store.getData().nodes = [];
}
void compileTimeReadonlyPins;

test('store getters still return live (readable) data', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-readonly-'));
    try {
        const io = await WorkspaceIO.create(asWorkspaceRoot(tmp));
        const store = new ImportEdgeListStore(path.join(tmp, '.llmem', 'graph'), io);

        store.addNodes([{ id: 'a.ts', name: 'a.ts', kind: 'file', fileId: 'a.ts' }]);

        assert.equal(store.getNodes().length, 1);
        assert.equal(store.getNodes().length, store.getStats().nodes);
        assert.equal(store.getData().nodes[0].id, 'a.ts');
        assert.equal(store.getEdges().length, 0);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
