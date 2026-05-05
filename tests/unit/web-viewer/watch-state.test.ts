// tests/unit/web-viewer/watch-state.test.ts
//
// Loop 16 — pin watch-state derivation behavior:
//   - collectAllFilePaths walks DOM under a folder path, returns
//     file-typed `data-path` values only
//   - areAllDescendantsWatched: empty-folder rule (false) + all-watched
//     rule (true) + any-unwatched rule (false)
//   - hasWatchedDescendant: any-watched rule
//   - updateButtons: per-file exact-match colour; per-folder
//     all-descendants colour
//
// JSDOM provides the DOM. Each test builds its own `<ul>` fixture
// matching the renderer's output (`.tree-node[data-path][data-type]`
// + `.status-btn[data-path]`).

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>');
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window as unknown;
g.document = dom.window.document;
g.HTMLElement = dom.window.HTMLElement;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createWatchStateCalculator } = require(
    '../../../src/webview/ui/components/worktree/watch-state',
) as {
    createWatchStateCalculator: () => {
        updateButtons(rootEl: HTMLElement, watched: ReadonlySet<string>): void;
        areAllDescendantsWatched(rootEl: HTMLElement, folderPath: string, watched: ReadonlySet<string>): boolean;
        hasWatchedDescendant(rootEl: HTMLElement, folderPath: string, watched: ReadonlySet<string>): boolean;
        collectAllFilePaths(rootEl: HTMLElement, folderPath: string): string[];
    };
};

function makeRoot(): HTMLElement {
    const root = dom.window.document.getElementById('root') as unknown as HTMLElement;
    root.innerHTML = '';
    return root;
}

function addFileButton(parent: HTMLElement, path: string): void {
    const li = parent.ownerDocument.createElement('li');
    li.className = 'tree-node';
    li.setAttribute('data-path', path);
    li.setAttribute('data-type', 'file');
    const btn = parent.ownerDocument.createElement('button');
    btn.className = 'status-btn';
    btn.setAttribute('data-path', path);
    btn.style.backgroundColor = '#ccc';
    li.appendChild(btn);
    parent.appendChild(li);
}

function addFolderButton(parent: HTMLElement, path: string): void {
    const li = parent.ownerDocument.createElement('li');
    li.className = 'tree-node';
    li.setAttribute('data-path', path);
    li.setAttribute('data-type', 'directory');
    const btn = parent.ownerDocument.createElement('button');
    btn.className = 'status-btn';
    btn.setAttribute('data-path', path);
    btn.style.backgroundColor = '#ccc';
    li.appendChild(btn);
    parent.appendChild(li);
}

test('watch-state.collectAllFilePaths: returns only file-typed descendants under folderPath', () => {
    const root = makeRoot();
    addFolderButton(root, 'src/foo');
    addFileButton(root, 'src/foo/a.ts');
    addFileButton(root, 'src/foo/b.ts');
    addFileButton(root, 'src/foo/sub/c.ts');
    addFileButton(root, 'src/bar/d.ts'); // NOT under src/foo

    const calc = createWatchStateCalculator();
    const paths = calc.collectAllFilePaths(root, 'src/foo');
    assert.deepEqual(paths.sort(), ['src/foo/a.ts', 'src/foo/b.ts', 'src/foo/sub/c.ts'].sort());
});

test('watch-state.areAllDescendantsWatched: all watched -> true', () => {
    const root = makeRoot();
    addFileButton(root, 'src/foo/a.ts');
    addFileButton(root, 'src/foo/b.ts');

    const calc = createWatchStateCalculator();
    const watched = new Set(['src/foo/a.ts', 'src/foo/b.ts']);
    assert.equal(calc.areAllDescendantsWatched(root, 'src/foo', watched), true);
});

test('watch-state.areAllDescendantsWatched: one unwatched -> false', () => {
    const root = makeRoot();
    addFileButton(root, 'src/foo/a.ts');
    addFileButton(root, 'src/foo/b.ts');

    const calc = createWatchStateCalculator();
    const watched = new Set(['src/foo/a.ts']);
    assert.equal(calc.areAllDescendantsWatched(root, 'src/foo', watched), false);
});

test('watch-state.areAllDescendantsWatched: empty folder -> false', () => {
    const root = makeRoot();
    // No files under src/empty.
    const calc = createWatchStateCalculator();
    assert.equal(calc.areAllDescendantsWatched(root, 'src/empty', new Set()), false);
});

test('watch-state.hasWatchedDescendant: any watched -> true; none -> false', () => {
    const root = makeRoot();
    addFileButton(root, 'src/foo/a.ts');
    addFileButton(root, 'src/foo/b.ts');
    const calc = createWatchStateCalculator();
    assert.equal(calc.hasWatchedDescendant(root, 'src/foo', new Set(['src/foo/a.ts'])), true);
    assert.equal(calc.hasWatchedDescendant(root, 'src/foo', new Set()), false);
});

test('watch-state.updateButtons: file watched -> green, others stay grey', () => {
    const root = makeRoot();
    addFolderButton(root, 'src/foo');
    addFileButton(root, 'src/foo/a.ts');
    addFileButton(root, 'src/foo/b.ts');

    const calc = createWatchStateCalculator();
    calc.updateButtons(root, new Set(['src/foo/a.ts']));

    const btns = root.querySelectorAll('.status-btn');
    const byPath = new Map<string, HTMLElement>();
    btns.forEach(b => byPath.set((b as HTMLElement).dataset.path!, b as HTMLElement));
    assert.equal(byPath.get('src/foo/a.ts')!.style.backgroundColor, 'rgb(74, 222, 128)'); // #4ade80
    assert.equal(byPath.get('src/foo/b.ts')!.style.backgroundColor, 'rgb(204, 204, 204)'); // #ccc
    // Folder is grey because not all descendants are watched.
    assert.equal(byPath.get('src/foo')!.style.backgroundColor, 'rgb(204, 204, 204)');
});

test('watch-state.updateButtons: all files watched -> folder also green', () => {
    const root = makeRoot();
    addFolderButton(root, 'src/foo');
    addFileButton(root, 'src/foo/a.ts');
    addFileButton(root, 'src/foo/b.ts');

    const calc = createWatchStateCalculator();
    calc.updateButtons(root, new Set(['src/foo/a.ts', 'src/foo/b.ts']));

    const btns = root.querySelectorAll('.status-btn');
    const byPath = new Map<string, HTMLElement>();
    btns.forEach(b => byPath.set((b as HTMLElement).dataset.path!, b as HTMLElement));
    assert.equal(byPath.get('src/foo')!.style.backgroundColor, 'rgb(74, 222, 128)');
});
