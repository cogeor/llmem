// tests/unit/web-viewer/sanitize.test.ts
//
// Pin the sanitize wrapper around DOMPurify used by the design-doc renderer
// (DesignTextView, DesignRender). Loop 13 introduced this as the XSS
// countermeasure for `.arch/<file>.md` payloads that pass through `marked`
// and then land in the webview's innerHTML.
//
// DOMPurify needs a DOM to operate. In the browser bundle `globalThis` is the
// `window` object. In Node, we boot a JSDOM window and patch globalThis BEFORE
// importing the sanitize module (which transitively triggers
// `createDOMPurify(getGlobal())` at module load).

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Boot a DOM and pin it to globalThis BEFORE importing sanitize. DOMPurify
// reads `globalThis.document` and `globalThis.Element` once at module load.
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window as unknown;
g.document = dom.window.document;
g.Element = dom.window.Element;
g.HTMLElement = dom.window.HTMLElement;
g.Node = dom.window.Node;
g.DocumentFragment = dom.window.DocumentFragment;
g.HTMLTemplateElement = dom.window.HTMLTemplateElement;
g.NodeFilter = dom.window.NodeFilter;
g.NamedNodeMap = dom.window.NamedNodeMap;
g.HTMLFormElement = dom.window.HTMLFormElement;
g.DOMParser = dom.window.DOMParser;

// Now safe to import — DOMPurify will boot against the DOM we just installed.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sanitizeHtml } = require('../../../src/webview/ui/utils/sanitize') as {
    sanitizeHtml: (html: string) => string;
};

test('sanitizeHtml: preserves plain paragraph', () => {
    assert.equal(sanitizeHtml('<p>hi</p>'), '<p>hi</p>');
});

test('sanitizeHtml: strips script tags entirely', () => {
    const out = sanitizeHtml('<p>before</p><script>alert(1)</script><p>after</p>');
    assert.ok(!out.toLowerCase().includes('<script'));
    assert.ok(!out.toLowerCase().includes('alert(1)'));
    assert.ok(out.includes('<p>before</p>'));
    assert.ok(out.includes('<p>after</p>'));
});

test('sanitizeHtml: strips inline event handlers from img', () => {
    const out = sanitizeHtml('<img src="x" onerror="alert(1)">');
    assert.ok(!out.toLowerCase().includes('onerror'));
    assert.ok(!out.toLowerCase().includes('alert(1)'));
});

test('sanitizeHtml: strips javascript: URLs from anchor href', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    assert.ok(!out.toLowerCase().includes('javascript:'));
    assert.ok(!out.toLowerCase().includes('alert(1)'));
});

test('sanitizeHtml: preserves common markdown structure', () => {
    const md = [
        '<h1>title</h1>',
        '<p>paragraph with <strong>bold</strong> and <em>em</em>.</p>',
        '<pre><code>const x = 1;</code></pre>',
        '<ul><li>one</li><li>two</li></ul>',
        '<a href="https://example.com">link</a>',
    ].join('');
    const out = sanitizeHtml(md);
    assert.ok(out.includes('<h1>title</h1>'));
    assert.ok(out.includes('<strong>bold</strong>'));
    assert.ok(out.includes('<em>em</em>'));
    assert.ok(out.includes('<pre>'));
    assert.ok(out.includes('<code>const x = 1;</code>'));
    assert.ok(out.includes('<li>one</li>'));
    assert.ok(out.includes('href="https://example.com"'));
});

test('sanitizeHtml: strips iframe', () => {
    const out = sanitizeHtml('<p>ok</p><iframe src="https://evil.example"></iframe>');
    assert.ok(!out.toLowerCase().includes('<iframe'));
    assert.ok(out.includes('<p>ok</p>'));
});

test('sanitizeHtml: strips style tag (data exfil vector)', () => {
    const out = sanitizeHtml('<style>body{background:red}</style><p>hi</p>');
    assert.ok(!out.toLowerCase().includes('<style'));
    assert.ok(out.includes('<p>hi</p>'));
});

test('sanitizeHtml: strips inline style attribute', () => {
    const out = sanitizeHtml('<p style="background:url(javascript:alert(1))">hi</p>');
    assert.ok(!out.toLowerCase().includes('style='));
    assert.ok(out.includes('<p>hi</p>') || out.includes('<p >hi</p>'));
});

test('sanitizeHtml: empty string returns empty string', () => {
    assert.equal(sanitizeHtml(''), '');
});

test('sanitizeHtml: preserves GFM table structure', () => {
    const html = '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>';
    const out = sanitizeHtml(html);
    assert.ok(out.includes('<table>'));
    assert.ok(out.includes('<th>a</th>'));
    assert.ok(out.includes('<td>1</td>'));
});

test('sanitizeHtml: synthetic XSS payload from .arch design doc', () => {
    // This is the payload Loop 13's verification step calls out: the
    // adversary controls the design-doc markdown and embeds raw HTML.
    const payload = [
        '# Doc',
        '',
        '<script>alert("XSS")</script>',
        '',
        '<img src=x onerror=alert(1)>',
    ].join('\n');
    // We feed the payload as if `marked` had already converted it to HTML.
    const asHtml = `<h1>Doc</h1><script>alert("XSS")</script><img src=x onerror=alert(1)>`;
    const out = sanitizeHtml(asHtml);
    assert.ok(!out.toLowerCase().includes('<script'));
    assert.ok(!out.toLowerCase().includes('onerror'));
    assert.ok(!out.toLowerCase().includes('alert'));
    assert.ok(out.includes('<h1>Doc</h1>'));
    // payload variable is part of the documentation example only.
    void payload;
});
