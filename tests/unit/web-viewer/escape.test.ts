// tests/unit/web-viewer/escape.test.ts
//
// Pin the HTML escape helper used by every browser-side template literal
// that interpolates filesystem-derived strings. Loop 13 introduced this as
// the XSS countermeasure for filenames like `<script>alert(1)</script>.ts`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { escape } from '../../../src/webview/ui/utils/escape';

test('escape: leaves plain text untouched', () => {
    assert.equal(escape('hello world'), 'hello world');
});

test('escape: <script> payload becomes inert', () => {
    assert.equal(
        escape('<script>alert(1)</script>'),
        '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
});

test('escape: handles ampersand without double-escaping subsequent entities', () => {
    // Note: this is a single pass — `&` becomes `&amp;` and the rest is
    // left as text. Already-escaped strings will be re-escaped, by design,
    // because the input contract is "raw filesystem data".
    assert.equal(escape('a & b'), 'a &amp; b');
    assert.equal(escape('&amp;'), '&amp;amp;');
});

test('escape: closes attribute-context vectors (quotes)', () => {
    assert.equal(escape('a"b\'c'), 'a&quot;b&#39;c');
});

test('escape: covers all five characters in one go', () => {
    assert.equal(escape(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

test('escape: empty string returns empty string', () => {
    assert.equal(escape(''), '');
});

test('escape: handles unicode without mangling', () => {
    assert.equal(escape('café — naïve'), 'café — naïve');
    assert.equal(escape('日本語'), '日本語');
});

test('escape: realistic filename with HTML payload is neutered', () => {
    const filename = '<img src=x onerror=alert(1)>.ts';
    const escaped = escape(filename);
    assert.equal(escaped, '&lt;img src=x onerror=alert(1)&gt;.ts');
    // The escaped form contains no raw `<` — interpolating it into innerHTML
    // is now safe (the `<img>` tag will not be parsed).
    assert.ok(!escaped.includes('<'));
});
