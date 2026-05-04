// tests/unit/web-viewer/static-data-provider.test.ts
//
// Loop 13 — pin StaticDataProvider's two new folder-data methods:
// `loadFolderTree()` and `loadFolderEdges()`. Both read browser-side
// globals (`window.FOLDER_TREE` / `window.FOLDER_EDGES`) injected by the
// generator in loop 11, gate by schema version, and return the typed
// payload.
//
// JSDOM harness mirrors `vscode-data-provider.test.ts`. Pin the window
// global on `globalThis` BEFORE requiring the provider so the constructor's
// reads against `window.location.origin` and `window.addEventListener`
// (via `liveReloadClient.on(...)`) land on the jsdom instance.
//
// **Test-folder convention deviation note**: the spec line in
// `02_folder_view.md` requested `tests/unit/webview/staticDataProvider.test.ts`
// but the existing repo convention places browser-side tests in
// `tests/unit/web-viewer/` (alongside `vscode-data-provider.test.ts`,
// `sanitize.test.ts`, etc.). Loop 13's PLAN.md called this out as the
// intended placement; reviewer may rename via `git mv` if they prefer
// spec-literal paths.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
    FOLDER_TREE_SCHEMA_VERSION,
    type FolderTreeData,
} from '../../../src/graph/folder-tree';
import {
    FOLDER_EDGES_SCHEMA_VERSION,
    type FolderEdgelistData,
} from '../../../src/graph/folder-edges';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost:3000/',
});
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window as unknown;
g.document = dom.window.document;
g.HTMLElement = dom.window.HTMLElement;
g.WebSocket = dom.window.WebSocket;

// StaticDataProvider's constructor instantiates a WatchApiClient (which
// reads `window.location.origin` at construction — no I/O), subscribes to
// `liveReloadClient.on('graph:updated', ...)` (pure listener registration),
// and `designDocCache.onChange(...)` (also pure). None of these block.
// Defer the `require` until after globals are pinned so the type imports
// inside the module resolve against the jsdom-backed `window` global.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { StaticDataProvider } = require('../../../src/webview/ui/services/staticDataProvider') as {
    StaticDataProvider: new () => {
        loadFolderTree(): Promise<FolderTreeData>;
        loadFolderEdges(): Promise<FolderEdgelistData>;
        hostKind: 'vscode' | 'browser';
    };
};

/**
 * Reset both globals before each test so cases own their setup; node:test
 * runs cases in source order but explicit reset is cheap and resilient
 * against future runner reordering.
 */
function resetFolderGlobals(): void {
    delete (dom.window as unknown as { FOLDER_TREE?: unknown }).FOLDER_TREE;
    delete (dom.window as unknown as { FOLDER_EDGES?: unknown }).FOLDER_EDGES;
}

test('StaticDataProvider: hostKind is "browser"', () => {
    resetFolderGlobals();
    const p = new StaticDataProvider();
    assert.equal(p.hostKind, 'browser');
});

test('StaticDataProvider.loadFolderTree returns the payload from window.FOLDER_TREE', async () => {
    resetFolderGlobals();
    const fixture: FolderTreeData = {
        schemaVersion: FOLDER_TREE_SCHEMA_VERSION,
        timestamp: '2026-05-03T00:00:00.000Z',
        root: {
            path: '',
            name: '',
            fileCount: 2,
            totalLOC: 100,
            documented: false,
            children: [
                {
                    path: 'src',
                    name: 'src',
                    fileCount: 2,
                    totalLOC: 100,
                    documented: false,
                    children: [],
                },
            ],
        },
    };
    (dom.window as unknown as { FOLDER_TREE: FolderTreeData }).FOLDER_TREE = fixture;

    const provider = new StaticDataProvider();
    const result = await provider.loadFolderTree();

    assert.deepEqual(result, fixture);
    assert.equal(result.schemaVersion, FOLDER_TREE_SCHEMA_VERSION);
});

test('StaticDataProvider.loadFolderEdges returns the payload from window.FOLDER_EDGES', async () => {
    resetFolderGlobals();
    const fixture: FolderEdgelistData = {
        schemaVersion: FOLDER_EDGES_SCHEMA_VERSION,
        timestamp: '2026-05-03T00:00:00.000Z',
        edges: [
            { from: 'src/a', to: 'src/b', kind: 'import', weight: 3 },
            { from: 'src/c', to: 'src/d', kind: 'call', weight: 1 },
        ],
        weightP90: 2.8,
    };
    (dom.window as unknown as { FOLDER_EDGES: FolderEdgelistData }).FOLDER_EDGES = fixture;

    const provider = new StaticDataProvider();
    const result = await provider.loadFolderEdges();

    assert.deepEqual(result, fixture);
    assert.equal(result.schemaVersion, FOLDER_EDGES_SCHEMA_VERSION);
    assert.equal(result.edges.length, 2);
});

test('StaticDataProvider.loadFolderTree throws when window.FOLDER_TREE is undefined', async () => {
    resetFolderGlobals();

    const provider = new StaticDataProvider();
    await assert.rejects(
        () => provider.loadFolderTree(),
        /window\.FOLDER_TREE is not set/,
    );
});

test('StaticDataProvider.loadFolderEdges throws when window.FOLDER_EDGES is undefined', async () => {
    resetFolderGlobals();

    const provider = new StaticDataProvider();
    await assert.rejects(
        () => provider.loadFolderEdges(),
        /window\.FOLDER_EDGES is not set/,
    );
});

test('StaticDataProvider.loadFolderTree throws on schemaVersion drift', async () => {
    // The webview cannot runtime-import FolderTreeSchema (it would pull
    // node-only `path` into the bundle), so the gate is a manual
    // schemaVersion equality check. Pin that the check fires when the
    // generator emits a future version the consumer doesn't know about.
    resetFolderGlobals();
    (dom.window as unknown as { FOLDER_TREE: { schemaVersion: number } }).FOLDER_TREE = {
        schemaVersion: 2,
    } as unknown as FolderTreeData;

    const provider = new StaticDataProvider();
    await assert.rejects(
        () => provider.loadFolderTree(),
        /unexpected schemaVersion 2/,
    );
});

test('StaticDataProvider.loadFolderEdges throws on schemaVersion drift', async () => {
    resetFolderGlobals();
    (dom.window as unknown as { FOLDER_EDGES: { schemaVersion: number } }).FOLDER_EDGES = {
        schemaVersion: 99,
    } as unknown as FolderEdgelistData;

    const provider = new StaticDataProvider();
    await assert.rejects(
        () => provider.loadFolderEdges(),
        /unexpected schemaVersion 99/,
    );
});
