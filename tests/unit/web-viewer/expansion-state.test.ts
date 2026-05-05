// tests/unit/web-viewer/expansion-state.test.ts
//
// Loop 16 — pin expansion-state persistence behavior:
//   - save in browser mode persists currently-expanded paths to
//     localStorage; vscode mode is a no-op
//   - restore in browser mode reads localStorage and applies the
//     `is-expanded` class + `aria-expanded="true"`
//   - malformed JSON triggers logger.warn instead of throwing
//   - missing-path entries silently no-op for that path; other paths
//     still apply
//
// JSDOM provides DOM + localStorage. Each test uses a per-test
// `storageKey` so cases do not pollute each other.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="root"></div></body></html>',
    { url: 'http://localhost:3000/' },
);
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window as unknown;
g.document = dom.window.document;
g.HTMLElement = dom.window.HTMLElement;
g.localStorage = dom.window.localStorage;
// jsdom does not implement CSS.escape; minimal polyfill is enough for
// filesystem paths used in our DOM fixtures.
g.CSS = { escape: (s: string) => s.replace(/(["\\])/g, '\\$1') };

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ExpansionStatePersister } = require(
    '../../../src/webview/ui/components/worktree/expansion-state',
) as {
    ExpansionStatePersister: new (props: {
        hostKind: 'vscode' | 'browser';
        logger?: { warn: (...args: unknown[]) => void };
        storageKey?: string;
    }) => {
        save(rootEl: HTMLElement): void;
        restore(rootEl: HTMLElement): void;
    };
};

function makeRoot(): HTMLElement {
    const root = dom.window.document.getElementById('root') as unknown as HTMLElement;
    root.innerHTML = '';
    return root;
}

function addExpandedFolder(parent: HTMLElement, path: string, expanded: boolean): HTMLElement {
    // Mirror the renderer output: a tree-node containing a tree-item
    // and a `<ul class="tree-children" data-path>` child.
    const li = parent.ownerDocument.createElement('li');
    li.className = 'tree-node';
    li.setAttribute('data-path', path);
    li.setAttribute('data-type', 'directory');
    const item = parent.ownerDocument.createElement('div');
    item.className = 'tree-item';
    li.appendChild(item);
    const children = parent.ownerDocument.createElement('ul');
    children.className = 'tree-children' + (expanded ? ' is-expanded' : '');
    children.setAttribute('data-path', path);
    li.appendChild(children);
    parent.appendChild(li);
    return li;
}

function makeStubLogger() {
    const calls: { level: string; args: unknown[] }[] = [];
    return {
        log: (...args: unknown[]) => calls.push({ level: 'log', args }),
        debug: (...args: unknown[]) => calls.push({ level: 'debug', args }),
        warn: (...args: unknown[]) => calls.push({ level: 'warn', args }),
        error: (...args: unknown[]) => calls.push({ level: 'error', args }),
        calls,
    };
}

test('expansion-state.save: browser mode persists expanded paths to localStorage', () => {
    const root = makeRoot();
    addExpandedFolder(root, 'src/a', true);
    addExpandedFolder(root, 'src/b', true);
    addExpandedFolder(root, 'src/c', false);

    const key = 'llmem:expandedPaths-test-save-browser';
    dom.window.localStorage.removeItem(key);

    const persister = new ExpansionStatePersister({ hostKind: 'browser', storageKey: key });
    persister.save(root);

    const raw = dom.window.localStorage.getItem(key);
    assert.ok(raw);
    const parsed = JSON.parse(raw!) as string[];
    assert.deepEqual(parsed.sort(), ['src/a', 'src/b'].sort());
});

test('expansion-state.save: vscode mode is a no-op', () => {
    const root = makeRoot();
    addExpandedFolder(root, 'src/a', true);

    const key = 'llmem:expandedPaths-test-save-vscode';
    dom.window.localStorage.removeItem(key);

    const persister = new ExpansionStatePersister({ hostKind: 'vscode', storageKey: key });
    persister.save(root);

    assert.equal(dom.window.localStorage.getItem(key), null);
});

test('expansion-state.restore: applies is-expanded + aria-expanded for persisted paths', () => {
    const root = makeRoot();
    addExpandedFolder(root, 'src/a', false);
    addExpandedFolder(root, 'src/b', false);

    const key = 'llmem:expandedPaths-test-restore-browser';
    dom.window.localStorage.setItem(key, JSON.stringify(['src/a', 'src/b']));

    const persister = new ExpansionStatePersister({ hostKind: 'browser', storageKey: key });
    persister.restore(root);

    const childrenA = root.querySelector('.tree-children[data-path="src/a"]');
    const childrenB = root.querySelector('.tree-children[data-path="src/b"]');
    const itemA = root.querySelector('[data-path="src/a"] .tree-item');
    const itemB = root.querySelector('[data-path="src/b"] .tree-item');
    assert.ok(childrenA!.classList.contains('is-expanded'));
    assert.ok(childrenB!.classList.contains('is-expanded'));
    assert.equal(itemA!.getAttribute('aria-expanded'), 'true');
    assert.equal(itemB!.getAttribute('aria-expanded'), 'true');
});

test('expansion-state.restore: malformed JSON triggers logger.warn, no throw', () => {
    const root = makeRoot();
    const key = 'llmem:expandedPaths-test-restore-malformed';
    dom.window.localStorage.setItem(key, '{ not valid json');

    const logger = makeStubLogger();
    const persister = new ExpansionStatePersister({
        hostKind: 'browser',
        storageKey: key,
        logger,
    });
    persister.restore(root); // must not throw

    const warnCalls = logger.calls.filter(c => c.level === 'warn');
    assert.equal(warnCalls.length, 1, 'one warn call');
    assert.equal(warnCalls[0]!.args[0], '[Worktree] Failed to restore expansion state:');
});

test('expansion-state.restore: missing path is a silent no-op for that entry', () => {
    const root = makeRoot();
    addExpandedFolder(root, 'src/exists', false);
    // Does NOT add 'src/missing'.

    const key = 'llmem:expandedPaths-test-restore-missing';
    dom.window.localStorage.setItem(key, JSON.stringify(['src/exists', 'src/missing']));

    const persister = new ExpansionStatePersister({ hostKind: 'browser', storageKey: key });
    persister.restore(root);

    const childrenExists = root.querySelector('.tree-children[data-path="src/exists"]');
    assert.ok(childrenExists!.classList.contains('is-expanded'));
});
