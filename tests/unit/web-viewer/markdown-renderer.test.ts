// tests/unit/web-viewer/markdown-renderer.test.ts
//
// Loop 19: lock in the centralized markdown -> sanitized HTML pipeline.
// `renderMarkdown` runs `marked` (GFM) and then DOMPurify on the Node side
// using its own internal JSDOM, so this test file does NOT need to boot
// JSDOM manually (unlike `tests/unit/web-viewer/sanitize.test.ts`). That
// internal boot is itself part of what we're testing.

import test from 'node:test';
import assert from 'node:assert/strict';

import { renderMarkdown } from '../../../src/webview/markdown-renderer';

test('renderMarkdown: heading is emitted as <h1>', async () => {
    const out = await renderMarkdown('# hi');
    assert.match(out, /<h1[^>]*>hi<\/h1>/);
});

test('renderMarkdown: fenced code block is emitted as <pre><code>', async () => {
    const md = '```ts\nconst x = 1;\n```';
    const out = await renderMarkdown(md);
    assert.ok(out.includes('<pre>'), `expected <pre> in: ${out}`);
    assert.ok(out.includes('<code'), `expected <code in: ${out}`);
    assert.ok(out.includes('const x = 1;'), `expected source in: ${out}`);
});

test('renderMarkdown: external link keeps href', async () => {
    const out = await renderMarkdown('[link](https://example.com)');
    assert.ok(out.includes('href="https://example.com"'), `expected href in: ${out}`);
});

test('renderMarkdown: <script>alert(1)</script> is stripped from markdown body', async () => {
    const out = await renderMarkdown('Body <script>alert(1)</script> end');
    assert.ok(!out.toLowerCase().includes('<script'), `did not expect <script in: ${out}`);
});

test('renderMarkdown: javascript: URL in markdown link is stripped or href removed', async () => {
    const out = await renderMarkdown('[x](javascript:alert(1))');
    assert.ok(!out.toLowerCase().includes('javascript:'), `did not expect javascript: in: ${out}`);
});

test('renderMarkdown: img with onerror has the handler stripped', async () => {
    const out = await renderMarkdown('<img src=x onerror=alert(1)>');
    assert.ok(!out.toLowerCase().includes('onerror'), `did not expect onerror in: ${out}`);
});

test('renderMarkdown: GFM table renders as <table>', async () => {
    const md = '| h |\n|---|\n| c |';
    const out = await renderMarkdown(md);
    assert.ok(out.includes('<table'), `expected <table in: ${out}`);
    assert.ok(out.includes('<th'), `expected <th in: ${out}`);
    assert.ok(out.includes('<td'), `expected <td in: ${out}`);
});

test('renderMarkdown: empty input returns empty string', async () => {
    const out = await renderMarkdown('');
    assert.equal(out, '');
});
