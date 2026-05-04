// tests/unit/web-viewer/package-view-arc-click.test.ts
//
// Loop 15 (Phase B) — pin the contract for PackageView's arc-click,
// node-click, and folderOf parity behavior:
//   - Clicking an arc filters window.GRAPH_DATA.{import,call}Graph.edges
//     by folderOf(from/to) and renders one row per matching file edge.
//   - Clicking a row in the bottom panel dispatches state.set with
//     currentView='graph', selectedType='file'.
//   - Clicking a folder node dispatches state.set with
//     currentView='graph', selectedType='directory'.
//   - The browser-pure folderOf duplicate matches path.posix.dirname
//     for the relative-path domain that FolderEdge endpoints inhabit.
//
// JSDOM harness mirrors loop 14's `package-view.test.ts` and loop 15
// Phase A's `package-view-edges.test.ts`. The StubNetwork records
// every `on(event, cb)` registration so tests can synthetically fire
// click/hover events.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';

import {
    FOLDER_TREE_SCHEMA_VERSION,
    type FolderTreeData,
} from '../../../src/graph/folder-tree';
import {
    FOLDER_EDGES_SCHEMA_VERSION,
    type FolderEdgelistData,
} from '../../../src/graph/folder-edges';

const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="package-view"></div></body></html>',
);
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window as unknown;
g.document = dom.window.document;

class StubNetwork {
    static lastInstance: StubNetwork | null = null;
    private listeners: Map<string, ((params: unknown) => void)[]> = new Map();
    constructor(_container: HTMLElement, _data: unknown) {
        StubNetwork.lastInstance = this;
    }
    on(event: string, cb: (params: unknown) => void): void {
        const list = this.listeners.get(event) ?? [];
        list.push(cb);
        this.listeners.set(event, list);
    }
    off(event: string): void {
        this.listeners.delete(event);
    }
    fire(event: string, params: unknown): void {
        const list = this.listeners.get(event) ?? [];
        for (const cb of list) cb(params);
    }
    destroy(): void {}
    body = {
        data: {
            edges: { update: () => {}, getIds: () => [] as string[] },
            nodes: { update: () => {} },
        },
    };
}
class StubDataSet {
    constructor(_items: unknown[]) {}
}

(dom.window as unknown as { vis: unknown }).vis = {
    Network: StubNetwork,
    DataSet: StubDataSet,
};
(g.window as { vis?: unknown }).vis = (dom.window as unknown as { vis: unknown }).vis;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PackageView } = require('../../../src/webview/ui/components/PackageView') as {
    PackageView: new (props: {
        el: HTMLElement;
        state: {
            get(): unknown;
            set(p: unknown): void;
            subscribe(cb: (s: unknown) => void): () => void;
        };
        dataProvider: {
            loadFolderTree(): Promise<FolderTreeData>;
            loadFolderEdges(): Promise<FolderEdgelistData>;
        };
    }) => {
        mount(): Promise<void>;
        unmount(): void;
        el: HTMLElement;
    };
};

function makeStubProvider(tree: FolderTreeData, edges: FolderEdgelistData) {
    return {
        loadFolderTree: async () => tree,
        loadFolderEdges: async () => edges,
    };
}

function makeCapturingState(): {
    get: () => unknown;
    set: (p: unknown) => void;
    subscribe: (cb: (s: unknown) => void) => () => void;
    calls: unknown[];
} {
    const calls: unknown[] = [];
    return {
        calls,
        get: () => ({}),
        set: (p) => {
            calls.push(p);
        },
        subscribe: () => () => undefined,
    };
}

function getEl(): HTMLElement {
    const el = dom.window.document.getElementById('package-view') as unknown as HTMLElement;
    el.innerHTML = '';
    return el;
}

test('PackageView arc click filters window.GRAPH_DATA by folderOf', async () => {
    (g.window as { GRAPH_DATA?: unknown }).GRAPH_DATA = {
        importGraph: {
            nodes: [],
            edges: [
                { from: 'src/parser/ts-extractor.ts', to: 'src/graph/types.ts' },
                { from: 'src/parser/ts-service.ts', to: 'src/graph/edgelist.ts' },
                // Same-folder import: must NOT match (folderOf both = src/parser).
                { from: 'src/parser/ts-extractor.ts', to: 'src/parser/registry.ts' },
                // Different from-folder: must NOT match.
                { from: 'src/webview/foo.ts', to: 'src/graph/types.ts' },
            ],
        },
        callGraph: { nodes: [], edges: [] },
    };

    const treeFixture: FolderTreeData = {
        schemaVersion: FOLDER_TREE_SCHEMA_VERSION,
        timestamp: '2026-05-03T00:00:00.000Z',
        root: {
            path: '',
            name: '',
            fileCount: 0,
            totalLOC: 0,
            documented: false,
            children: [
                {
                    path: 'src/parser',
                    name: 'parser',
                    fileCount: 0,
                    totalLOC: 0,
                    documented: false,
                    children: [],
                },
                {
                    path: 'src/graph',
                    name: 'graph',
                    fileCount: 0,
                    totalLOC: 0,
                    documented: false,
                    children: [],
                },
            ],
        },
    };
    const edgesFixture: FolderEdgelistData = {
        schemaVersion: FOLDER_EDGES_SCHEMA_VERSION,
        timestamp: '2026-05-03T00:00:00.000Z',
        edges: [{ from: 'src/parser', to: 'src/graph', kind: 'import', weight: 2 }],
        weightP90: 0,
    };

    const el = getEl();
    const state = makeCapturingState();
    const view = new PackageView({
        el,
        state,
        dataProvider: makeStubProvider(treeFixture, edgesFixture),
    });
    await view.mount();

    const network = StubNetwork.lastInstance;
    assert.ok(network, 'StubNetwork constructed');

    // Fire the arc click.
    network!.fire('click', {
        nodes: [],
        edges: ['import|src/parser|src/graph'],
    });

    // Bottom panel populated.
    const panel = el.querySelector('.package-bottom-panel') as HTMLElement;
    assert.ok(panel, 'bottom panel exists');
    assert.equal(panel.style.display, 'block', 'panel visible after arc click');

    const rows = panel.querySelectorAll('.package-edge-row');
    assert.equal(rows.length, 2, 'only 2 file edges match (parser → graph), not 4');

    // Row content: from-files are the parser files; to-files are the graph files.
    const fromPaths = Array.from(rows).map((r) => (r as HTMLElement).dataset.from);
    assert.deepEqual(
        fromPaths.sort(),
        ['src/parser/ts-extractor.ts', 'src/parser/ts-service.ts'],
    );
});

test('PackageView edge-row click navigates to graph view scoped to source file', async () => {
    (g.window as { GRAPH_DATA?: unknown }).GRAPH_DATA = {
        importGraph: {
            nodes: [],
            edges: [
                { from: 'src/parser/ts-extractor.ts', to: 'src/graph/types.ts' },
            ],
        },
        callGraph: { nodes: [], edges: [] },
    };

    const treeFixture: FolderTreeData = {
        schemaVersion: FOLDER_TREE_SCHEMA_VERSION,
        timestamp: '2026-05-03T00:00:00.000Z',
        root: {
            path: '',
            name: '',
            fileCount: 0,
            totalLOC: 0,
            documented: false,
            children: [
                {
                    path: 'src/parser',
                    name: 'parser',
                    fileCount: 0,
                    totalLOC: 0,
                    documented: false,
                    children: [],
                },
                {
                    path: 'src/graph',
                    name: 'graph',
                    fileCount: 0,
                    totalLOC: 0,
                    documented: false,
                    children: [],
                },
            ],
        },
    };
    const edgesFixture: FolderEdgelistData = {
        schemaVersion: FOLDER_EDGES_SCHEMA_VERSION,
        timestamp: '2026-05-03T00:00:00.000Z',
        edges: [{ from: 'src/parser', to: 'src/graph', kind: 'import', weight: 2 }],
        weightP90: 0,
    };

    const el = getEl();
    const state = makeCapturingState();
    const view = new PackageView({
        el,
        state,
        dataProvider: makeStubProvider(treeFixture, edgesFixture),
    });
    await view.mount();
    StubNetwork.lastInstance!.fire('click', {
        nodes: [],
        edges: ['import|src/parser|src/graph'],
    });

    const link = el.querySelector('.package-edge-link') as HTMLElement;
    assert.ok(link, 'link present');
    link.click();

    const navCall = state.calls.find(
        (c) =>
            typeof c === 'object' &&
            c !== null &&
            (c as { currentView?: unknown }).currentView === 'graph',
    ) as
        | { currentView: string; selectedPath: string; selectedType: string }
        | undefined;
    assert.ok(navCall, 'state.set called with currentView=graph');
    assert.equal(navCall!.selectedPath, 'src/parser/ts-extractor.ts');
    assert.equal(navCall!.selectedType, 'file');
});

test('PackageView node click navigates to graph view scoped to folder', async () => {
    const tree: FolderTreeData = {
        schemaVersion: FOLDER_TREE_SCHEMA_VERSION,
        timestamp: '2026-05-03T00:00:00.000Z',
        root: {
            path: '',
            name: '',
            fileCount: 0,
            totalLOC: 0,
            documented: false,
            children: [
                {
                    path: 'src/parser',
                    name: 'parser',
                    fileCount: 0,
                    totalLOC: 0,
                    documented: false,
                    children: [],
                },
            ],
        },
    };
    const edges: FolderEdgelistData = {
        schemaVersion: FOLDER_EDGES_SCHEMA_VERSION,
        timestamp: '2026-05-03T00:00:00.000Z',
        edges: [],
        weightP90: 0,
    };
    const state = makeCapturingState();
    const view = new PackageView({
        el: getEl(),
        state,
        dataProvider: makeStubProvider(tree, edges),
    });
    await view.mount();
    StubNetwork.lastInstance!.fire('click', { nodes: ['src/parser'], edges: [] });

    const navCall = state.calls.find(
        (c) =>
            typeof c === 'object' &&
            c !== null &&
            (c as { selectedPath?: unknown }).selectedPath === 'src/parser',
    ) as { selectedPath: string; selectedType: string } | undefined;
    assert.ok(navCall);
    assert.equal(navCall!.selectedType, 'directory');
});

test('PackageView folderOf matches src/graph/folder-edges.ts canonical impl', async () => {
    // Sanity-check the canonical helper for the parity domain we care
    // about (relative paths with forward-slash separators).
    const cases: { fileId: string; expectedFolder: string }[] = [
        { fileId: 'a.ts', expectedFolder: '.' },
        { fileId: 'src/parser/ts-extractor.ts', expectedFolder: 'src/parser' },
        { fileId: 'a/b/c/d.ts', expectedFolder: 'a/b/c' },
    ];
    for (const c of cases) {
        const canonical = path.posix.dirname(c.fileId.replaceAll('\\', '/'));
        assert.equal(canonical, c.expectedFolder, `canonical(${c.fileId}) === ${c.expectedFolder}`);
    }

    // The actual PackageView.folderOf is module-private. We assert
    // its behavior indirectly: an edge whose from/to map to the
    // expected folder pair is matched by the click filter (top-level
    // file folderOf=".").
    const tree: FolderTreeData = {
        schemaVersion: FOLDER_TREE_SCHEMA_VERSION,
        timestamp: '2026-05-03T00:00:00.000Z',
        root: {
            path: '',
            name: '',
            fileCount: 0,
            totalLOC: 0,
            documented: false,
            children: [
                {
                    path: '.',
                    name: '.',
                    fileCount: 0,
                    totalLOC: 0,
                    documented: false,
                    children: [],
                },
                {
                    path: 'src/parser',
                    name: 'parser',
                    fileCount: 0,
                    totalLOC: 0,
                    documented: false,
                    children: [],
                },
            ],
        },
    };
    const edges: FolderEdgelistData = {
        schemaVersion: FOLDER_EDGES_SCHEMA_VERSION,
        timestamp: '2026-05-03T00:00:00.000Z',
        edges: [{ from: '.', to: 'src/parser', kind: 'import', weight: 1 }],
        weightP90: 0,
    };
    (g.window as { GRAPH_DATA: unknown }).GRAPH_DATA = {
        importGraph: {
            nodes: [],
            edges: [{ from: 'a.ts', to: 'src/parser/ts-extractor.ts' }],
        },
        callGraph: { nodes: [], edges: [] },
    };
    const el = getEl();
    const view = new PackageView({
        el,
        state: makeCapturingState(),
        dataProvider: makeStubProvider(tree, edges),
    });
    await view.mount();
    StubNetwork.lastInstance!.fire('click', {
        nodes: [],
        edges: ['import|.|src/parser'],
    });
    const rows = el.querySelectorAll('.package-edge-row');
    assert.equal(rows.length, 1, 'top-level file (folderOf=".") matched');
});
