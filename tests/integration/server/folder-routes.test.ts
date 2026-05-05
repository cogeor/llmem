/**
 * Loop 12 — HTTP routes /api/folder-tree and /api/folder-edges.
 *
 * Three cases:
 *   1. Happy path — fixture workspace with two TS files in sibling folders;
 *      after `scanFolderRecursive` + `buildAndSaveFolderArtifacts`, both
 *      routes return 200 with Zod-valid bodies. Regression net: `/api/stats`
 *      still returns 200 in the same harness, proving the registrar didn't
 *      break the existing route surface.
 *   2. Missing artifacts — a fresh workspace with no scan run; both routes
 *      return 404 with the literal `{ error: 'NOT_FOUND', message: ... }`
 *      body the UI consumer relies on.
 *
 * The test mints its own tmp workspace via `mkdtempSync`, hands it to
 * `withServer` via `config.workspaceRoot`, and lets the harness's `finally`
 * block do the cleanup (it `fs.rmSync(...)`s the workspace root).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { withServer } from '../../contracts/_helpers/build-server';
import {
    FolderTreeSchema,
    FOLDER_TREE_SCHEMA_VERSION,
} from '../../../src/graph/folder-tree';
import { FolderEdgelistSchema } from '../../../src/graph/folder-edges';
import { scanFolderRecursive } from '../../../src/application/scan';
import { buildAndSaveFolderArtifacts } from '../../../src/application/folder-artifacts';
import { createWorkspaceContext } from '../../../src/application/workspace-context';

/**
 * Build a fixture workspace with two files in different folders so the
 * folder-edges aggregator emits at least one cross-folder import edge.
 * Mirrors the loop-10 `buildFixture` shape.
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

/**
 * Run `scanFolderRecursive` followed by `buildAndSaveFolderArtifacts`,
 * leaving `folder-tree.json` and `folder-edgelist.json` on disk.
 */
async function populateArtifacts(tmp: string): Promise<void> {
    const ctx = await createWorkspaceContext({ workspaceRoot: tmp });
    await scanFolderRecursive(ctx, { folderPath: '.' });
    await buildAndSaveFolderArtifacts(ctx);
}

test('GET /api/folder-tree + /api/folder-edges: happy path returns 200 + Zod-valid bodies', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-folder-routes-'));
    buildFixture(tmp);
    await populateArtifacts(tmp);

    await withServer(
        { config: { workspaceRoot: tmp } },
        async (request) => {
            const treeRes = await request({ path: '/api/folder-tree' });
            assert.equal(treeRes.status, 200);
            const tree = JSON.parse(treeRes.body);
            assert.doesNotThrow(() => FolderTreeSchema.parse(tree));
            assert.equal(tree.schemaVersion, FOLDER_TREE_SCHEMA_VERSION);

            const edgesRes = await request({ path: '/api/folder-edges' });
            assert.equal(edgesRes.status, 200);
            const edges = JSON.parse(edgesRes.body);
            assert.doesNotThrow(() => FolderEdgelistSchema.parse(edges));

            // Regression net — /api/stats still 200 after the registrar
            // gained two new entries. The webview routes ('graph', 'design')
            // are static and outside this harness; /api/stats is the
            // canonical "registered API still works" probe.
            const statsRes = await request({ path: '/api/stats' });
            assert.equal(statsRes.status, 200);
            const stats = JSON.parse(statsRes.body);
            assert.equal(typeof stats.fileCount, 'number');
        },
    );
    // No explicit `rm(tmp)` — withServer's finally handles it.
});

test('GET /api/folder-tree + /api/folder-edges: missing artifacts return 404 + structured error body', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-folder-routes-empty-'));

    await withServer(
        { config: { workspaceRoot: tmp } },
        async (request) => {
            const treeRes = await request({ path: '/api/folder-tree' });
            assert.equal(treeRes.status, 404);
            assert.deepEqual(JSON.parse(treeRes.body), {
                error: 'NOT_FOUND',
                message: 'No folder tree available — run `llmem scan` first.',
            });

            const edgesRes = await request({ path: '/api/folder-edges' });
            assert.equal(edgesRes.status, 404);
            assert.deepEqual(JSON.parse(edgesRes.body), {
                error: 'NOT_FOUND',
                message: 'No folder edges available — run `llmem scan` first.',
            });
        },
    );
});
