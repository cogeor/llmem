// tests/unit/web-viewer/package-view.test.ts
//
// Loop 14 — pin the contract for PackageView's static-skeleton render path:
//   - one card per non-root folder
//   - ✎ glyph iff `documented === true`
//   - empty-state when `loadFolderTree()` rejects
//   - depth-based margin-left indentation
//   - `unmount()` clears the DOM
//
// JSDOM harness mirrors `static-data-provider.test.ts`. The DataProvider
// is stubbed (loop-14 component never reads/writes State, so a minimal
// stub suffices). PackageView is required AFTER the window/document
// globals are pinned to keep the harness pattern consistent with
// loop 13's static-data-provider test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
    FOLDER_TREE_SCHEMA_VERSION,
    type FolderTreeData,
} from '../../../src/graph/folder-tree';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="package-view"></div></body></html>');
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window as unknown;
g.document = dom.window.document;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PackageView } = require('../../../src/webview/ui/components/PackageView') as {
    PackageView: new (props: {
        el: HTMLElement;
        state: { get(): unknown; set(p: unknown): void; subscribe(cb: (s: unknown) => void): () => void };
        dataProvider: { loadFolderTree(): Promise<FolderTreeData> };
    }) => {
        mount(): Promise<void>;
        unmount(): void;
        el: HTMLElement;
    };
};

function makeStubProvider(tree: FolderTreeData | (() => Promise<FolderTreeData>)) {
    return {
        loadFolderTree: async () => {
            return typeof tree === 'function' ? await tree() : tree;
        },
    };
}

function makeStubState() {
    return {
        get: () => ({}),
        set: () => undefined,
        subscribe: () => () => undefined,
    };
}

function getPackageViewEl(): HTMLElement {
    return dom.window.document.getElementById('package-view') as unknown as HTMLElement;
}

test('PackageView.mount renders one card per folder in the tree', async () => {
    const fixture: FolderTreeData = {
        schemaVersion: FOLDER_TREE_SCHEMA_VERSION,
        timestamp: '2026-05-03T00:00:00.000Z',
        root: {
            path: '',
            name: '',
            fileCount: 4,
            totalLOC: 200,
            documented: false,
            children: [
                {
                    path: 'src',
                    name: 'src',
                    fileCount: 4,
                    totalLOC: 200,
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
            ],
        },
    };

    const el = getPackageViewEl();
    el.innerHTML = '';
    const view = new PackageView({
        el,
        state: makeStubState(),
        dataProvider: makeStubProvider(fixture),
    });

    await view.mount();

    const cards = el.querySelectorAll('.package-card');
    // 3 non-root folders: src, src/parser, src/graph.
    assert.equal(cards.length, 3);
});

test('PackageView.mount renders the ✎ glyph only when documented=true', async () => {
    const fixture: FolderTreeData = {
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
                    path: 'docs',
                    name: 'docs',
                    fileCount: 1,
                    totalLOC: 10,
                    documented: true,
                    children: [],
                },
                {
                    path: 'undocumented',
                    name: 'undocumented',
                    fileCount: 1,
                    totalLOC: 10,
                    documented: false,
                    children: [],
                },
            ],
        },
    };

    const el = getPackageViewEl();
    el.innerHTML = '';
    const view = new PackageView({
        el,
        state: makeStubState(),
        dataProvider: makeStubProvider(fixture),
    });

    await view.mount();

    const docsCard = Array.from(el.querySelectorAll('.package-card')).find(
        (c) => (c as HTMLElement).dataset.path === 'docs',
    ) as HTMLElement;
    const undocumentedCard = Array.from(el.querySelectorAll('.package-card')).find(
        (c) => (c as HTMLElement).dataset.path === 'undocumented',
    ) as HTMLElement;

    assert.ok(docsCard, 'docs card must be present');
    assert.ok(undocumentedCard, 'undocumented card must be present');

    assert.ok(
        docsCard.querySelector('.package-glyph'),
        'documented card must contain a .package-glyph element',
    );
    assert.equal(
        undocumentedCard.querySelector('.package-glyph'),
        null,
        'undocumented card must NOT contain a .package-glyph element',
    );
});

test('PackageView.mount renders an empty-state when loadFolderTree throws', async () => {
    const el = getPackageViewEl();
    el.innerHTML = '';
    const view = new PackageView({
        el,
        state: makeStubState(),
        dataProvider: makeStubProvider(async () => {
            throw new Error('window.FOLDER_TREE is not set');
        }),
    });

    // mount() must NOT reject — it has to handle the missing-data case
    // gracefully so the bootstrap's Promise.all in main.ts doesn't break.
    await view.mount();

    const empty = el.querySelector('.package-empty');
    assert.ok(empty, 'empty-state must render when loadFolderTree throws');
    assert.match(
        (empty as HTMLElement).textContent ?? '',
        /window\.FOLDER_TREE is not set/,
        'empty-state must surface the underlying error message',
    );
});

test('PackageView.mount renders nested folders with depth-based indentation', async () => {
    const fixture: FolderTreeData = {
        schemaVersion: FOLDER_TREE_SCHEMA_VERSION,
        timestamp: '2026-05-03T00:00:00.000Z',
        root: {
            path: '',
            name: '',
            fileCount: 1,
            totalLOC: 10,
            documented: false,
            children: [
                {
                    path: 'a',
                    name: 'a',
                    fileCount: 1,
                    totalLOC: 10,
                    documented: false,
                    children: [
                        {
                            path: 'a/b',
                            name: 'b',
                            fileCount: 1,
                            totalLOC: 10,
                            documented: false,
                            children: [
                                {
                                    path: 'a/b/c',
                                    name: 'c',
                                    fileCount: 1,
                                    totalLOC: 10,
                                    documented: false,
                                    children: [],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    };

    const el = getPackageViewEl();
    el.innerHTML = '';
    const view = new PackageView({
        el,
        state: makeStubState(),
        dataProvider: makeStubProvider(fixture),
    });

    await view.mount();

    const cards = Array.from(el.querySelectorAll('.package-card')) as HTMLElement[];
    assert.equal(cards.length, 3, 'must render 3 cards (a, a/b, a/b/c)');

    const aCard = cards.find((c) => c.dataset.path === 'a')!;
    const bCard = cards.find((c) => c.dataset.path === 'a/b')!;
    const cCard = cards.find((c) => c.dataset.path === 'a/b/c')!;

    // Depth-based indentation: a=0px, a/b=16px, a/b/c=32px. JSDOM may render
    // a 0px margin-left as either '0px' or '' (empty string) — the regex
    // covers both.
    assert.match(aCard.style.marginLeft, /^(?:0px|)$/);
    assert.equal(bCard.style.marginLeft, '16px');
    assert.equal(cCard.style.marginLeft, '32px');
});

test('PackageView.unmount clears the rendered cards', async () => {
    const fixture: FolderTreeData = {
        schemaVersion: FOLDER_TREE_SCHEMA_VERSION,
        timestamp: '2026-05-03T00:00:00.000Z',
        root: {
            path: '',
            name: '',
            fileCount: 0,
            totalLOC: 0,
            documented: false,
            children: [
                { path: 'x', name: 'x', fileCount: 0, totalLOC: 0, documented: false, children: [] },
            ],
        },
    };
    const el = getPackageViewEl();
    el.innerHTML = '';
    const view = new PackageView({
        el,
        state: makeStubState(),
        dataProvider: makeStubProvider(fixture),
    });
    await view.mount();
    assert.ok(el.querySelector('.package-card'), 'card present after mount');

    view.unmount();
    assert.equal(el.querySelector('.package-card'), null, 'cards cleared after unmount');
});
