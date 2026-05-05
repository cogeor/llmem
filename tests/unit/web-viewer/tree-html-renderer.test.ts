// tests/unit/web-viewer/tree-html-renderer.test.ts
//
// Loop 16 — pin the tree HTML rendering contract:
//   - file nodes get `data-path` and `data-type="file"`
//   - parsable files get a `<button class="status-btn">`; non-parsable
//     files do not
//   - depth-based `padding-left: ${depth * 12 + 12}px` indent
//   - HTML escape contract: every node name/path is escaped via
//     utils/escape before interpolation
//   - `isParsableFile`, `hasAnyParsableFiles` mirror the pre-loop-16
//     methods on the orchestrator
//
// No JSDOM is required — the renderer returns HTML strings and never
// touches the DOM. Tests parse with `JSDOM` only to assert structure.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { TreeHtmlRenderer } = require(
    '../../../src/webview/ui/components/worktree/tree-html-renderer',
) as {
    TreeHtmlRenderer: new () => {
        render(node: unknown): string;
        isParsableFile(node: unknown): boolean;
        hasAnyParsableFiles(node: unknown): boolean;
    };
};

function fileNode(path: string, isSupported = true) {
    return {
        type: 'file',
        path,
        name: path.split('/').pop() ?? path,
        lineCount: 1,
        isSupported,
    };
}

function dirNode(path: string, children: unknown[]) {
    return {
        type: 'directory',
        path,
        name: path.split('/').pop() ?? path,
        children,
    };
}

function parseTree(html: string): Document {
    return new JSDOM(`<div id="root">${html}</div>`).window.document;
}

test('tree-html-renderer: single file renders as tree-node[data-type=file]', () => {
    const renderer = new TreeHtmlRenderer();
    const html = renderer.render(fileNode('src/foo.ts'));
    const doc = parseTree(html);
    const node = doc.querySelector('.tree-node');
    assert.ok(node, 'expected .tree-node');
    assert.equal(node!.getAttribute('data-path'), 'src/foo.ts');
    assert.equal(node!.getAttribute('data-type'), 'file');
});

test('tree-html-renderer: parsable + non-parsable siblings render with toggle only on parsable', () => {
    const renderer = new TreeHtmlRenderer();
    const html = renderer.render(
        dirNode('src', [
            fileNode('src/yes.ts', true),
            fileNode('src/no.ts', false),
        ]),
    );
    const doc = parseTree(html);
    const yesNode = doc.querySelector('[data-path="src/yes.ts"]');
    const noNode = doc.querySelector('[data-path="src/no.ts"]');
    assert.ok(yesNode && noNode, 'both file nodes rendered');
    assert.ok(yesNode!.querySelector('.status-btn'), 'parsable file gets status-btn');
    assert.equal(noNode!.querySelector('.status-btn'), null, 'non-parsable file has no status-btn');
});

test('tree-html-renderer: nested tree preserves padding-left = depth*12 + 12', () => {
    const renderer = new TreeHtmlRenderer();
    const tree = dirNode('a', [
        dirNode('a/b', [
            dirNode('a/b/c', [fileNode('a/b/c/leaf.ts')]),
        ]),
    ]);
    const html = renderer.render(tree);
    const doc = parseTree(html);
    // depth 0 -> 12px (root 'a'); depth 1 -> 24px (a/b); depth 2 -> 36px (a/b/c); depth 3 -> 48px (leaf)
    const expected: Record<string, string> = {
        a: '12px',
        'a/b': '24px',
        'a/b/c': '36px',
        'a/b/c/leaf.ts': '48px',
    };
    for (const [path, padding] of Object.entries(expected)) {
        const node = doc.querySelector(`[data-path="${path}"] .tree-item`) as HTMLElement | null;
        assert.ok(node, `node ${path} present`);
        assert.match(
            node!.getAttribute('style') || '',
            new RegExp(`padding-left:\\s*${padding}`),
            `${path} indent should be ${padding}`,
        );
    }
});

test('tree-html-renderer: HTML escape contract — script tags in node name are escaped', () => {
    const renderer = new TreeHtmlRenderer();
    const html = renderer.render({
        type: 'file',
        path: 'src/<script>alert(1)</script>.ts',
        name: '<script>alert(1)</script>',
        lineCount: 1,
        isSupported: true,
    });
    // The raw HTML must NOT contain a literal `<script>` tag — escape
    // turns `<` into `&lt;`. Look at the raw output directly (parsing
    // it via JSDOM would un-escape).
    assert.ok(!/<script>alert/.test(html), 'unescaped <script> not present');
    assert.ok(/&lt;script&gt;alert/.test(html), 'escaped &lt;script&gt; present');
});

test('tree-html-renderer.isParsableFile: true iff isSupported === true', () => {
    const renderer = new TreeHtmlRenderer();
    assert.equal(renderer.isParsableFile({ isSupported: true } as unknown as never), true);
    assert.equal(renderer.isParsableFile({ isSupported: false } as unknown as never), false);
    assert.equal(renderer.isParsableFile({} as unknown as never), false);
});

test('tree-html-renderer.hasAnyParsableFiles: true iff any descendant is parsable', () => {
    const renderer = new TreeHtmlRenderer();
    const allParsable = dirNode('a', [fileNode('a/x.ts', true)]);
    const noneParsable = dirNode('b', [fileNode('b/x.ts', false), fileNode('b/y.ts', false)]);
    const mixed = dirNode('c', [fileNode('c/x.ts', false), fileNode('c/y.ts', true)]);
    assert.equal(renderer.hasAnyParsableFiles(allParsable), true);
    assert.equal(renderer.hasAnyParsableFiles(noneParsable), false);
    assert.equal(renderer.hasAnyParsableFiles(mixed), true);
});
