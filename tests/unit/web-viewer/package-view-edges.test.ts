// tests/unit/web-viewer/package-view-edges.test.ts
//
// Loop 15 (Phase A) — pin the contract for PackageView's folder-arc
// rendering path:
//   - Default density: only edges with weight >= weightP90 render.
//   - "Show all edges" toggle re-renders with weightP90 ignored.
//   - Each VisNetworkEdge round-trips its underlying FolderEdge via
//     `__folderEdge` so the arc-click handler can recover it.
//   - Cards-only fallback when `loadFolderEdges` rejects (loop 14
//     contract preserved).
//
// JSDOM harness mirrors loop 14's `package-view.test.ts` and pins
// `window.vis` with a stub Network class that captures every
// `new vis.Network(...)` call so we can assert on the rendered nodes
// and edges without an actual canvas.

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

const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="package-view"></div></body></html>',
);
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window as unknown;
g.document = dom.window.document;

interface CapturedCall {
    nodes: { id: string; label: string }[];
    edges: { id: string; from: string; to: string; __folderEdge?: unknown }[];
}
const captured: CapturedCall[] = [];

class StubNetwork {
    constructor(_container: HTMLElement, data: CapturedCall) {
        captured.push({ nodes: [...data.nodes], edges: [...data.edges] });
    }
    on(_event: string, _cb: (params: unknown) => void): void {}
    off(_event: string): void {}
    destroy(): void {}
    body = {
        data: {
            edges: { update: (_e: unknown) => {}, getIds: () => [] as string[] },
            nodes: { update: (_n: unknown) => {} },
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

// Pin globalThis.window.vis so PackageView's `window.vis` lookup hits
// the stub. JSDOM's window != globalThis by default; the test setup
// syncs them at top-of-file.
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

function makeStubState() {
    return {
        get: () => ({}),
        set: () => undefined,
        subscribe: () => () => undefined,
    };
}

function getEl(): HTMLElement {
    const el = dom.window.document.getElementById('package-view') as unknown as HTMLElement;
    el.innerHTML = '';
    return el;
}

const treeFixture: FolderTreeData = {
    schemaVersion: FOLDER_TREE_SCHEMA_VERSION,
    timestamp: '2026-05-03T00:00:00.000Z',
    root: {
        path: '',
        name: '',
        fileCount: 4,
        totalLOC: 0,
        documented: false,
        children: [
            {
                path: 'src',
                name: 'src',
                fileCount: 4,
                totalLOC: 0,
                documented: false,
                children: [
                    {
                        path: 'src/parser',
                        name: 'parser',
                        fileCount: 2,
                        totalLOC: 0,
                        documented: true,
                        children: [],
                    },
                    {
                        path: 'src/graph',
                        name: 'graph',
                        fileCount: 2,
                        totalLOC: 0,
                        documented: false,
                        children: [],
                    },
                ],
            },
        ],
    },
};

test('PackageView renders only edges >= weightP90 by default', async () => {
    const edgesFixture: FolderEdgelistData = {
        schemaVersion: FOLDER_EDGES_SCHEMA_VERSION,
        timestamp: '2026-05-03T00:00:00.000Z',
        edges: [
            { from: 'src/parser', to: 'src/graph', kind: 'import', weight: 47 },
            { from: 'src/graph', to: 'src/parser', kind: 'import', weight: 3 },
            { from: 'src/parser', to: 'src/graph', kind: 'call', weight: 12 },
            { from: 'src/graph', to: 'src/parser', kind: 'call', weight: 2 },
        ],
        weightP90: 10, // hand-set: only edges with weight >= 10 render by default
    };
    captured.length = 0;

    const view = new PackageView({
        el: getEl(),
        state: makeStubState(),
        dataProvider: makeStubProvider(treeFixture, edgesFixture),
    });
    await view.mount();

    assert.equal(captured.length, 1, 'vis.Network constructed exactly once');
    const renderedEdges = captured[0].edges;
    assert.equal(renderedEdges.length, 2, 'only 2 edges (weight >= 10) render by default');

    const ids = new Set(renderedEdges.map((e) => e.id));
    assert.ok(ids.has('import|src/parser|src/graph'), 'import 47 (>=10) renders');
    assert.ok(ids.has('call|src/parser|src/graph'), 'call 12 (>=10) renders');
    assert.ok(!ids.has('import|src/graph|src/parser'), 'import 3 (<10) hidden');
    assert.ok(!ids.has('call|src/graph|src/parser'), 'call 2 (<10) hidden');
});

test('PackageView renders all edges after toggling Show all edges', async () => {
    const edgesFixture: FolderEdgelistData = {
        schemaVersion: FOLDER_EDGES_SCHEMA_VERSION,
        timestamp: '2026-05-03T00:00:00.000Z',
        edges: [
            { from: 'src/parser', to: 'src/graph', kind: 'import', weight: 47 },
            { from: 'src/graph', to: 'src/parser', kind: 'import', weight: 3 },
            { from: 'src/parser', to: 'src/graph', kind: 'call', weight: 12 },
            { from: 'src/graph', to: 'src/parser', kind: 'call', weight: 2 },
        ],
        weightP90: 10,
    };
    captured.length = 0;

    const el = getEl();
    const view = new PackageView({
        el,
        state: makeStubState(),
        dataProvider: makeStubProvider(treeFixture, edgesFixture),
    });
    await view.mount();
    assert.equal(captured.length, 1, 'initial mount → 1 network');

    // Click the show-all checkbox.
    const checkbox = el.querySelector('.package-show-all-edges') as HTMLInputElement;
    assert.ok(checkbox, 'show-all checkbox present');
    checkbox.checked = true;
    checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    // After the toggle, setupNetwork() ran again → captured grows by 1.
    assert.equal(captured.length, 2, 'toggle → second network');
    const renderedEdges = captured[1].edges;
    assert.equal(renderedEdges.length, 4, 'all 4 edges render after toggle');
});

test('PackageView attaches __folderEdge to each VisNetworkEdge', async () => {
    const edgesFixture: FolderEdgelistData = {
        schemaVersion: FOLDER_EDGES_SCHEMA_VERSION,
        timestamp: '2026-05-03T00:00:00.000Z',
        edges: [{ from: 'a', to: 'b', kind: 'import', weight: 5 }],
        weightP90: 0, // render everything
    };
    captured.length = 0;
    const view = new PackageView({
        el: getEl(),
        state: makeStubState(),
        dataProvider: makeStubProvider(
            {
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
                            path: 'a',
                            name: 'a',
                            fileCount: 0,
                            totalLOC: 0,
                            documented: false,
                            children: [],
                        },
                        {
                            path: 'b',
                            name: 'b',
                            fileCount: 0,
                            totalLOC: 0,
                            documented: false,
                            children: [],
                        },
                    ],
                },
            },
            edgesFixture,
        ),
    });
    await view.mount();
    const renderedEdges = captured[0].edges;
    assert.equal(renderedEdges.length, 1);
    assert.deepEqual(renderedEdges[0].__folderEdge, {
        from: 'a',
        to: 'b',
        kind: 'import',
        weight: 5,
    });
});

test('PackageView renders cards when loadFolderEdges throws (no network created)', async () => {
    captured.length = 0;
    const provider = {
        loadFolderTree: async () => treeFixture,
        loadFolderEdges: async () => {
            throw new Error('window.FOLDER_EDGES is not set');
        },
    };
    const el = getEl();
    const view = new PackageView({
        el,
        state: makeStubState(),
        dataProvider: provider,
    });
    await view.mount();

    // Cards rendered (loop 14 contract preserved).
    const cards = el.querySelectorAll('.package-card');
    assert.equal(cards.length, 3, 'src + src/parser + src/graph cards');
    // No network attempted.
    assert.equal(captured.length, 0, 'vis.Network never constructed');
});
