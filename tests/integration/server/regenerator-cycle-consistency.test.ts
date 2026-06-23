/**
 * Recompute consistency: when a watched source file changes such that a
 * dependency CYCLE is broken, the live-server regenerator must drop the now-gone
 * import edge so the cycle stops being reported (and stops being painted red in
 * the webview).
 *
 * Regression guard: `rescanSourcesAndRegenerate` used to call the append-only
 * `scanFile`, which never removed a file's prior edges — so an edit that deleted
 * an import left the stale edge behind and `computeInCycleEdgeKeys` kept flagging
 * a cycle that no longer existed in the code. The fix routes per-file recompute
 * through the remove-then-add `refreshFileGraph` (and purges deleted files).
 *
 * The test drives the regenerator directly with a stubbed WebSocketService; no
 * HTTP server boots. It asserts on the persisted import edge list + the SCC
 * engine, which is exactly what feeds the red-edge payload.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    rescanSourcesAndRegenerate,
} from '../../../src/http-server/regenerator';
import { scanFolderRecursive } from '../../../src/application/scan';
import { createWorkspaceContext } from '../../../src/application/workspace-context';
import { ImportEdgeListStore } from '../../../src/graph/edgelist';
import { buildGraphsFromSplitEdgeLists } from '../../../src/graph';
import { computeInCycleEdgeKeys } from '../../../src/graph/scc';
import { NoopLogger } from '../../../src/core/logger';
import type { WebSocketService } from '../../../src/http-server/websocket';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DIST_WEBVIEW_INDEX = path.join(REPO_ROOT, 'dist', 'webview', 'index.html');

function ensureBuilt(): void {
    if (!fs.existsSync(DIST_WEBVIEW_INDEX)) {
        throw new Error(
            `Expected ${DIST_WEBVIEW_INDEX} to exist. ` +
            `Run "npm run build:webview" first (or "npm test", which builds it in pretest).`,
        );
    }
}

function makeStubWebSocket(): WebSocketService {
    return {
        broadcast: () => { /* no-op */ },
        broadcastArchEvent: () => { /* no-op */ },
        broadcastGraphUpdate: () => { /* no-op */ },
        broadcastReload: () => { /* no-op */ },
        getClientCount: () => 0,
    } as unknown as WebSocketService;
}

/** True iff the persisted import graph has a non-trivial cycle. */
async function hasImportCycle(ctx: Awaited<ReturnType<typeof createWorkspaceContext>>): Promise<boolean> {
    const importStore = new ImportEdgeListStore(ctx.artifactRoot, ctx.io);
    await importStore.load();
    // Call graph is irrelevant to import-cycle detection; pass an empty store's data.
    const { importGraph } = buildGraphsFromSplitEdgeLists(
        importStore.getData(),
        { version: '2.0.0', timestamp: '', nodes: [], edges: [] } as any,
    );
    return computeInCycleEdgeKeys(importGraph).size > 0;
}

test('rescanSourcesAndRegenerate: breaking a cycle in code removes the stale cycle', async () => {
    ensureBuilt();

    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-regen-cyc-'));
    const tmp = path.join(parent, 'workspace');
    fs.mkdirSync(tmp);
    try {
        // Two files forming an import cycle: a <-> b.
        fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
        const aPath = path.join(tmp, 'src', 'a.ts');
        const bPath = path.join(tmp, 'src', 'b.ts');
        fs.writeFileSync(aPath, "import { b } from './b';\nexport const a = () => b();\n", 'utf8');
        fs.writeFileSync(bPath, "import { a } from './a';\nexport const b = () => a();\n", 'utf8');

        const ctx = await createWorkspaceContext({ workspaceRoot: tmp });

        // Seed edge lists with a full scan, confirm the cycle is present.
        await scanFolderRecursive(ctx, { folderPath: '.' });
        assert.equal(await hasImportCycle(ctx), true, 'fixture should start with an a<->b import cycle');

        // Break the cycle: a.ts no longer imports b.
        fs.writeFileSync(aPath, 'export const a = () => 1;\n', 'utf8');

        const deps = {
            ctx,
            verbose: false,
            webSocket: makeStubWebSocket(),
            logger: NoopLogger,
        };
        await rescanSourcesAndRegenerate(['src/a.ts'], deps);

        // The stale a->b edge must be gone, so no cycle remains.
        const importStore = new ImportEdgeListStore(ctx.artifactRoot, ctx.io);
        await importStore.load();
        const stillHasAtoB = importStore
            .getData()
            .edges.some((e) => e.source === 'src/a.ts' && e.target === 'src/b.ts');
        assert.equal(stillHasAtoB, false, 'a->b import edge should be removed after the edit');
        assert.equal(await hasImportCycle(ctx), false, 'cycle must clear once the import is removed');
    } finally {
        fs.rmSync(parent, { recursive: true, force: true });
    }
});

test('rescanSourcesAndRegenerate: deleting a file in a cycle purges its edges', async () => {
    ensureBuilt();

    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-regen-cyc-'));
    const tmp = path.join(parent, 'workspace');
    fs.mkdirSync(tmp);
    try {
        fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
        const aPath = path.join(tmp, 'src', 'a.ts');
        const bPath = path.join(tmp, 'src', 'b.ts');
        fs.writeFileSync(aPath, "import { b } from './b';\nexport const a = () => b();\n", 'utf8');
        fs.writeFileSync(bPath, "import { a } from './a';\nexport const b = () => a();\n", 'utf8');

        const ctx = await createWorkspaceContext({ workspaceRoot: tmp });
        await scanFolderRecursive(ctx, { folderPath: '.' });
        assert.equal(await hasImportCycle(ctx), true, 'fixture should start with an a<->b import cycle');

        // Delete a.ts entirely, then notify the regenerator about it.
        fs.rmSync(aPath);
        const deps = {
            ctx,
            verbose: false,
            webSocket: makeStubWebSocket(),
            logger: NoopLogger,
        };
        await rescanSourcesAndRegenerate(['src/a.ts'], deps);

        const importStore = new ImportEdgeListStore(ctx.artifactRoot, ctx.io);
        await importStore.load();
        const touchesA = importStore
            .getData()
            .edges.some((e) => e.source === 'src/a.ts' || e.target === 'src/a.ts');
        assert.equal(touchesA, false, 'all edges touching the deleted file must be purged (by source AND target)');
        assert.equal(await hasImportCycle(ctx), false, 'cycle must clear once a participating file is deleted');
    } finally {
        fs.rmSync(parent, { recursive: true, force: true });
    }
});
