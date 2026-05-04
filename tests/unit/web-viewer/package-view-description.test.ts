// tests/unit/web-viewer/package-view-description.test.ts
//
// Loop 16 — pin the contract for PackageView's folder-description panel:
//   - When a folder card is "selected" via state (selectedPath +
//     selectedType: 'directory'), the description panel renders the
//     folder's README via DesignRender.
//   - When the folder has no README in designDocs, the panel renders the
//     `llmem document <path>` empty-state suggestion.
//   - When selectedPath is null OR selectedType is not 'directory', the
//     panel hides itself.
//
// JSDOM harness mirrors `package-view-arc-click.test.ts`. The State stub
// captures the subscribe callback so the test drives onStateChange()
// transitions explicitly rather than relying on the immediate-call
// behavior of the real State.subscribe.

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

class StubNetwork {
    static lastInstance: StubNetwork | null = null;
    constructor(_container: HTMLElement, _data: unknown) {
        StubNetwork.lastInstance = this;
    }
    on(_event: string, _cb: (params: unknown) => void): void {}
    off(_event: string): void {}
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

// window.GRAPH_DATA is read by the loop-15 click handlers; default to an
// empty stub so the description-only tests never trip the bottom panel.
(g.window as { GRAPH_DATA?: unknown }).GRAPH_DATA = {
    importGraph: { nodes: [], edges: [] },
    callGraph: { nodes: [], edges: [] },
};

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
            loadDesignDocs(): Promise<Record<string, { markdown: string; html: string }>>;
        };
    }) => {
        mount(): Promise<void>;
        unmount(): void;
        el: HTMLElement;
    };
};

interface FakeAppState {
    currentView: 'graph' | 'design' | 'packages' | 'folders';
    selectedPath: string | null;
    selectedType: 'file' | 'directory' | null;
}

function makeFakeState(initial: FakeAppState): {
    data: FakeAppState;
    listeners: ((s: FakeAppState) => void)[];
    get(): FakeAppState;
    set(partial: Partial<FakeAppState>): void;
    subscribe(cb: (s: FakeAppState) => void): () => void;
} {
    const listeners: ((s: FakeAppState) => void)[] = [];
    const state = {
        data: { ...initial },
        listeners,
        get() {
            return state.data;
        },
        set(partial: Partial<FakeAppState>) {
            state.data = { ...state.data, ...partial };
            for (const cb of state.listeners) cb(state.data);
        },
        subscribe(cb: (s: FakeAppState) => void) {
            state.listeners.push(cb);
            cb(state.data);
            return () => {
                const i = state.listeners.indexOf(cb);
                if (i >= 0) state.listeners.splice(i, 1);
            };
        },
    };
    return state;
}

function makeProvider(
    tree: FolderTreeData,
    edges: FolderEdgelistData,
    designDocs: Record<string, { markdown: string; html: string }>,
) {
    return {
        loadFolderTree: async () => tree,
        loadFolderEdges: async () => edges,
        loadDesignDocs: async () => designDocs,
    };
}

function getEl(): HTMLElement {
    const el = dom.window.document.getElementById('package-view') as unknown as HTMLElement;
    el.innerHTML = '';
    return el;
}

function makeTreeFixture(): FolderTreeData {
    return {
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
                    fileCount: 2,
                    totalLOC: 100,
                    documented: true,
                    children: [],
                },
                {
                    path: 'src/graph',
                    name: 'graph',
                    fileCount: 2,
                    totalLOC: 100,
                    documented: false,
                    children: [],
                },
            ],
        },
    };
}

function makeEdgesFixture(): FolderEdgelistData {
    return {
        schemaVersion: FOLDER_EDGES_SCHEMA_VERSION,
        timestamp: '2026-05-03T00:00:00.000Z',
        edges: [],
        weightP90: 0,
    };
}

test('PackageView renders README via DesignRender when folder has design doc', async () => {
    const designDocs = {
        'src/parser/README.md': {
            markdown: '# parser\n\nThis is the parser folder.',
            html: '<h1>parser</h1>\n<p>This is the parser folder.</p>',
        },
    };
    const state = makeFakeState({
        currentView: 'packages',
        selectedPath: null,
        selectedType: null,
    });

    const view = new PackageView({
        el: getEl(),
        state,
        dataProvider: makeProvider(makeTreeFixture(), makeEdgesFixture(), designDocs),
    });

    await view.mount();

    // Drive selection — emulates a card click forwarding into state.
    state.set({ selectedPath: 'src/parser', selectedType: 'directory' });

    const panel = view.el.querySelector('.package-description-panel') as HTMLElement;
    assert.ok(panel, 'description panel must exist');
    assert.equal(panel.style.display, 'block', 'panel visible after selection');

    // DesignRender mounts a `.design-view-content` element with the
    // sanitized HTML inside the panel.
    const content = panel.querySelector('.design-view-content');
    assert.ok(content, 'DesignRender must inject .design-view-content');
    assert.match(
        content!.innerHTML,
        /<h1>parser<\/h1>/,
        'rendered HTML must contain the parser heading',
    );
    assert.doesNotMatch(
        panel.textContent ?? '',
        /No design doc yet/,
        'placeholder must not render when README is present',
    );
});

test('PackageView shows CLI suggestion when folder has no design doc', async () => {
    // Note: src/graph has no README in designDocs.
    const designDocs = {
        'src/parser/README.md': {
            markdown: '# parser',
            html: '<h1>parser</h1>',
        },
    };
    const state = makeFakeState({
        currentView: 'packages',
        selectedPath: null,
        selectedType: null,
    });

    const view = new PackageView({
        el: getEl(),
        state,
        dataProvider: makeProvider(makeTreeFixture(), makeEdgesFixture(), designDocs),
    });

    await view.mount();
    state.set({ selectedPath: 'src/graph', selectedType: 'directory' });

    const panel = view.el.querySelector('.package-description-panel') as HTMLElement;
    assert.ok(panel, 'description panel must exist');
    assert.equal(panel.style.display, 'block', 'panel visible even when doc is missing');
    assert.match(
        panel.textContent ?? '',
        /No design doc yet — run/,
        'placeholder text must mention the missing doc',
    );
    assert.match(
        panel.innerHTML,
        /<code>llmem document src\/graph<\/code>/,
        'placeholder must include the CLI suggestion with the forward-slash path',
    );
    assert.equal(
        panel.querySelector('.design-view-content'),
        null,
        'DesignRender content must NOT render in the placeholder branch',
    );
});

test('PackageView hides description panel when no folder is selected', async () => {
    const state = makeFakeState({
        currentView: 'packages',
        selectedPath: 'src/parser',
        selectedType: 'directory',
    });

    const view = new PackageView({
        el: getEl(),
        state,
        dataProvider: makeProvider(makeTreeFixture(), makeEdgesFixture(), {
            'src/parser/README.md': {
                markdown: '# p',
                html: '<h1>p</h1>',
            },
        }),
    });

    await view.mount();
    // Initial subscribe-call rendered the panel.
    const panel = view.el.querySelector('.package-description-panel') as HTMLElement;
    assert.equal(panel.style.display, 'block', 'initial selection renders the panel');

    // Clear the selection.
    state.set({ selectedPath: null, selectedType: null });
    assert.equal(panel.style.display, 'none', 'panel hidden after selection cleared');
    assert.equal(panel.innerHTML, '', 'panel inner HTML cleared after selection cleared');
});

test('PackageView keeps description panel hidden when route is not packages', async () => {
    const state = makeFakeState({
        // Route is 'graph' — even though selection points to a folder,
        // the description panel is a packages-route concern only.
        currentView: 'graph',
        selectedPath: null,
        selectedType: null,
    });

    const view = new PackageView({
        el: getEl(),
        state,
        dataProvider: makeProvider(makeTreeFixture(), makeEdgesFixture(), {
            'src/parser/README.md': {
                markdown: '# p',
                html: '<h1>p</h1>',
            },
        }),
    });

    await view.mount();
    state.set({ selectedPath: 'src/parser', selectedType: 'directory' });

    const panel = view.el.querySelector('.package-description-panel') as HTMLElement;
    assert.equal(
        panel.style.display,
        'none',
        'description panel must stay hidden outside the packages route',
    );
});

test('PackageView card click drives state.set without changing currentView', async () => {
    const state = makeFakeState({
        currentView: 'packages',
        selectedPath: null,
        selectedType: null,
    });

    const view = new PackageView({
        el: getEl(),
        state,
        dataProvider: makeProvider(makeTreeFixture(), makeEdgesFixture(), {
            'src/parser/README.md': {
                markdown: '# parser',
                html: '<h1>parser</h1>',
            },
        }),
    });

    await view.mount();

    const card = view.el.querySelector(
        '.package-card[data-path="src/parser"]',
    ) as HTMLElement | null;
    assert.ok(card, 'parser card must be rendered');
    card!.click();

    // After the click, currentView must remain 'packages' and selection
    // must point at src/parser as a directory.
    assert.equal(state.data.currentView, 'packages', 'card click must NOT change route');
    assert.equal(state.data.selectedPath, 'src/parser');
    assert.equal(state.data.selectedType, 'directory');
});
