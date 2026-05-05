/**
 * Loop 10 — `regenerateWebview` emits folder-tree.json + folder-edgelist.json.
 *
 * Three cases:
 *   1. Happy path — fresh workspace with two TS files in different folders;
 *      after `regenerateWebview` both folder artifacts exist on disk and
 *      load cleanly through the loop-09 stores (Zod validation).
 *   2. Idempotency — calling `regenerateWebview` twice in succession
 *      produces byte-identical content modulo the `timestamp` fields.
 *   3. Documented-folder propagation — placing `.arch/src/a/README.md`
 *      before regenerate causes the matching `FolderNode` to surface as
 *      `documented: true`.
 *
 * The test calls `regenerateWebview` directly with a stubbed
 * `WebSocketService` whose `broadcast` is a no-op; no HTTP server boots.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { regenerateWebview } from '../../../src/claude/server/regenerator';
import { scanFolderRecursive } from '../../../src/application/scan';
import { createWorkspaceContext } from '../../../src/application/workspace-context';
import {
    FolderTreeStore,
    FOLDER_TREE_FILENAME,
} from '../../../src/graph/folder-tree-store';
import {
    FolderEdgelistStore,
    FOLDER_EDGELIST_FILENAME,
} from '../../../src/graph/folder-edges-store';
import { NoopLogger } from '../../../src/core/logger';
import type { WebSocketService } from '../../../src/claude/server/websocket';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DIST_WEBVIEW_INDEX = path.join(REPO_ROOT, 'dist', 'webview', 'index.html');

function ensureBuilt(): void {
    if (!fs.existsSync(DIST_WEBVIEW_INDEX)) {
        throw new Error(
            `Expected ${DIST_WEBVIEW_INDEX} to exist. ` +
            `Run "npm run build:webview" first (or use "npm test", which runs build:webview as part of pretest).`,
        );
    }
}

function mkTmp(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rm(p: string): void {
    try {
        fs.rmSync(p, { recursive: true, force: true });
    } catch {
        // Best-effort cleanup — Windows file watchers can delay release.
    }
}

/**
 * Minimal stub. The regenerator only calls `broadcast({type, message})`;
 * other surface members are present for the type cast.
 */
function makeStubWebSocket(): WebSocketService {
    return {
        broadcast: () => { /* no-op */ },
        broadcastArchEvent: () => { /* no-op */ },
        broadcastGraphUpdate: () => { /* no-op */ },
        broadcastReload: () => { /* no-op */ },
        getClientCount: () => 0,
    } as unknown as WebSocketService;
}

/**
 * Build a fixture workspace with two files in different folders so the
 * folder-edges aggregator emits at least one cross-folder edge.
 */
function buildFixture(tmp: string): void {
    fs.mkdirSync(path.join(tmp, 'src', 'a'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'src', 'b'), { recursive: true });
    fs.writeFileSync(
        path.join(tmp, 'src', 'a', 'a.ts'),
        'export const a = 1;\n',
        'utf8',
    );
    fs.writeFileSync(
        path.join(tmp, 'src', 'b', 'b.ts'),
        "import { a } from '../a/a';\nexport const b = a + 1;\n",
        'utf8',
    );
}

test('regenerateWebview: emits folder-tree.json + folder-edgelist.json on happy path', async () => {
    ensureBuilt();

    const parent = mkTmp('llmem-regen-fa-');
    const tmp = path.join(parent, 'workspace');
    fs.mkdirSync(tmp);
    try {
        buildFixture(tmp);

        const ctx = await createWorkspaceContext({ workspaceRoot: tmp });
        const artifactDir = ctx.artifactRoot;

        // Populate edge lists first (simulates the per-file scan upstream).
        await scanFolderRecursive(ctx, { folderPath: '.' });

        const stubWs = makeStubWebSocket();
        await regenerateWebview({
            ctx,
            verbose: false,
            webSocket: stubWs,
            logger: NoopLogger,
        });

        // Both folder artifacts exist on disk.
        const treePath = path.join(artifactDir, FOLDER_TREE_FILENAME);
        const edgesPath = path.join(artifactDir, FOLDER_EDGELIST_FILENAME);
        assert.ok(fs.existsSync(treePath), `expected ${treePath} to exist`);
        assert.ok(fs.existsSync(edgesPath), `expected ${edgesPath} to exist`);

        // Load via the stores → Zod validation.
        const tree = await new FolderTreeStore(artifactDir, ctx.io).load();
        assert.equal(tree.schemaVersion, 1);
        // Two files total under the tree.
        assert.equal(tree.root.fileCount, 2);

        const edges = await new FolderEdgelistStore(artifactDir, ctx.io).load();
        assert.equal(edges.schemaVersion, 1);
        // src/b imports from src/a → at least one import edge.
        const importEdges = edges.edges.filter((e) => e.kind === 'import');
        assert.ok(
            importEdges.length >= 1,
            `expected at least one folder-level import edge, got ${JSON.stringify(edges.edges)}`,
        );
        const cross = importEdges.find((e) => e.from === 'src/b' && e.to === 'src/a');
        assert.ok(
            cross,
            `expected an edge from src/b to src/a, got ${JSON.stringify(importEdges)}`,
        );
    } finally {
        rm(parent);
    }
});

test('regenerateWebview: idempotent across two calls (modulo timestamp)', async () => {
    ensureBuilt();

    const parent = mkTmp('llmem-regen-fa-');
    const tmp = path.join(parent, 'workspace');
    fs.mkdirSync(tmp);
    try {
        buildFixture(tmp);

        const ctx = await createWorkspaceContext({ workspaceRoot: tmp });
        const artifactDir = ctx.artifactRoot;

        await scanFolderRecursive(ctx, { folderPath: '.' });

        const stubWs = makeStubWebSocket();
        const deps = {
            ctx,
            verbose: false,
            webSocket: stubWs,
            logger: NoopLogger,
        };

        await regenerateWebview(deps);
        const treeFirst = JSON.parse(
            fs.readFileSync(path.join(artifactDir, FOLDER_TREE_FILENAME), 'utf-8'),
        );
        const edgesFirst = JSON.parse(
            fs.readFileSync(path.join(artifactDir, FOLDER_EDGELIST_FILENAME), 'utf-8'),
        );

        await regenerateWebview(deps);
        const treeSecond = JSON.parse(
            fs.readFileSync(path.join(artifactDir, FOLDER_TREE_FILENAME), 'utf-8'),
        );
        const edgesSecond = JSON.parse(
            fs.readFileSync(path.join(artifactDir, FOLDER_EDGELIST_FILENAME), 'utf-8'),
        );

        // Strip timestamps and compare.
        delete treeFirst.timestamp;
        delete treeSecond.timestamp;
        assert.deepEqual(
            treeSecond,
            treeFirst,
            'folder-tree should be idempotent modulo timestamp',
        );

        delete edgesFirst.timestamp;
        delete edgesSecond.timestamp;
        assert.deepEqual(
            edgesSecond,
            edgesFirst,
            'folder-edgelist should be idempotent modulo timestamp',
        );
    } finally {
        rm(parent);
    }
});

test('regenerateWebview: propagates documented folders from .arch/', async () => {
    ensureBuilt();

    const parent = mkTmp('llmem-regen-fa-');
    const tmp = path.join(parent, 'workspace');
    fs.mkdirSync(tmp);
    try {
        buildFixture(tmp);

        // Mark src/a as documented BEFORE regenerate.
        fs.mkdirSync(path.join(tmp, '.arch', 'src', 'a'), { recursive: true });
        fs.writeFileSync(
            path.join(tmp, '.arch', 'src', 'a', 'README.md'),
            '# src/a\n',
            'utf8',
        );

        const ctx = await createWorkspaceContext({ workspaceRoot: tmp });
        const artifactDir = ctx.artifactRoot;

        await scanFolderRecursive(ctx, { folderPath: '.' });

        const stubWs = makeStubWebSocket();
        await regenerateWebview({
            ctx,
            verbose: false,
            webSocket: stubWs,
            logger: NoopLogger,
        });

        const tree = await new FolderTreeStore(artifactDir, ctx.io).load();

        // Walk to src/a and src/b.
        function findByPath(node: typeof tree.root, target: string): typeof tree.root | null {
            if (node.path === target) return node;
            for (const child of node.children) {
                const hit = findByPath(child, target);
                if (hit) return hit;
            }
            return null;
        }

        const srcA = findByPath(tree.root, 'src/a');
        const srcB = findByPath(tree.root, 'src/b');
        assert.ok(srcA, 'expected to find src/a in folder-tree');
        assert.ok(srcB, 'expected to find src/b in folder-tree');
        assert.equal(srcA.documented, true, 'src/a should be marked documented');
        assert.equal(srcB.documented, false, 'src/b should NOT be marked documented');
    } finally {
        rm(parent);
    }
});
