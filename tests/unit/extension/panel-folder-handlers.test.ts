/**
 * Loop 02 — pin the data-plumbing contract that the panel's
 * `_loadFolderTree` / `_loadFolderEdges` handlers depend on.
 *
 * `src/extension/panel.ts` imports `vscode`, which is unavailable under
 * `node:test`. So instead of importing the panel directly, this file
 * exercises the two stores the panel constructs (`FolderTreeStore` /
 * `FolderEdgelistStore`) with the same `(artifactDir, io)` shape the
 * panel uses. The wire shape (panel echoes `data:folderTree` /
 * `data:folderEdges` with the original `requestId`) is pinned by the
 * loop-13 tests in `tests/unit/web-viewer/vscode-data-provider.test.ts`.
 *
 * Together: the loop-13 tests pin the message shape both sides agree on,
 * and these tests pin the load round-trip + missing-file rejection that
 * the panel's catch block relays back as `data:folderTree.error`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { WorkspaceIO } from '../../../src/workspace/workspace-io';
import { asWorkspaceRoot } from '../../../src/core/paths';
import {
    FolderTreeStore,
} from '../../../src/graph/folder-tree-store';
import {
    FolderEdgelistStore,
} from '../../../src/graph/folder-edges-store';
import {
    FolderTreeLoadError,
    type FolderTreeData,
} from '../../../src/graph/folder-tree';
import {
    FolderEdgelistLoadError,
    type FolderEdgelistData,
} from '../../../src/graph/folder-edges';

function mkWorkspace(): { tmp: string; artifactDir: string } {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-panel-fh-'));
    const artifactDir = path.join(tmp, '.artifacts');
    fs.mkdirSync(artifactDir, { recursive: true });
    return { tmp, artifactDir };
}

test('panel handler data path: FolderTreeStore.load returns the saved tree', async () => {
    const { tmp, artifactDir } = mkWorkspace();
    try {
        const io = await WorkspaceIO.create(asWorkspaceRoot(tmp));
        const writer = new FolderTreeStore(artifactDir, io);

        const fixture: FolderTreeData = {
            schemaVersion: 1,
            timestamp: '2026-05-05T00:00:00.000Z',
            root: {
                path: '',
                name: '',
                fileCount: 1,
                totalLOC: 10,
                documented: false,
                children: [
                    {
                        path: 'src',
                        name: 'src',
                        fileCount: 1,
                        totalLOC: 10,
                        documented: true,
                        children: [],
                    },
                ],
            },
        };
        await writer.save(fixture);

        // Fresh store — load via the same construction shape the panel uses.
        const reader = new FolderTreeStore(artifactDir, io);
        const loaded = await reader.load();

        // `save()` re-stamps the timestamp; root must round-trip identically.
        assert.deepEqual(loaded.root, fixture.root);
        assert.equal(loaded.schemaVersion, fixture.schemaVersion);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('panel handler data path: FolderEdgelistStore.load returns the saved edges', async () => {
    const { tmp, artifactDir } = mkWorkspace();
    try {
        const io = await WorkspaceIO.create(asWorkspaceRoot(tmp));
        const writer = new FolderEdgelistStore(artifactDir, io);

        const fixture: FolderEdgelistData = {
            schemaVersion: 1,
            timestamp: '2026-05-05T00:00:00.000Z',
            edges: [
                { from: 'src/a', to: 'src/b', kind: 'import', weight: 3 },
                { from: 'src/a', to: 'src/b', kind: 'call', weight: 1 },
            ],
            weightP90: 3,
        };
        await writer.save(fixture);

        const reader = new FolderEdgelistStore(artifactDir, io);
        const loaded = await reader.load();

        assert.deepEqual(loaded.edges, fixture.edges);
        assert.equal(loaded.weightP90, fixture.weightP90);
        assert.equal(loaded.schemaVersion, fixture.schemaVersion);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('panel handler data path: FolderTreeStore.load throws FolderTreeLoadError when missing', async () => {
    const { tmp, artifactDir } = mkWorkspace();
    try {
        const io = await WorkspaceIO.create(asWorkspaceRoot(tmp));
        const store = new FolderTreeStore(artifactDir, io);
        // No file written. The panel's `_loadFolderTree` catch block relays
        // `e.message` back to the webview as `data:folderTree.error`, which
        // the loop-13 test (`...rejects when host responds with an error`)
        // already exercises end-to-end.
        await assert.rejects(store.load(), FolderTreeLoadError);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('panel handler data path: FolderEdgelistStore.load throws FolderEdgelistLoadError when missing', async () => {
    const { tmp, artifactDir } = mkWorkspace();
    try {
        const io = await WorkspaceIO.create(asWorkspaceRoot(tmp));
        const store = new FolderEdgelistStore(artifactDir, io);
        await assert.rejects(store.load(), FolderEdgelistLoadError);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
