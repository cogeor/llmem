/**
 * Loop 02 — pin the `requireElement` helper that replaces the previous
 * `as HTMLElement` casts in `src/webview/ui/main.ts`. The helper lives in
 * `src/webview/ui/dom-validation.ts`; pulling it out of `main.ts` keeps
 * the test surface tiny (no need to import the full module-side-effect
 * graph just to exercise the lookup).
 *
 * Boots a JSDOM window the same way the loop-13/14 vscode-data-provider
 * tests do — pin `globalThis.window`, `globalThis.document`,
 * `globalThis.HTMLElement` BEFORE requiring the module under test.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window as unknown;
g.document = dom.window.document;
g.HTMLElement = dom.window.HTMLElement;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { requireElement } = require('../../../src/webview/ui/dom-validation') as {
    requireElement: (id: string) => HTMLElement;
};

test('requireElement returns the element when present', () => {
    const div = dom.window.document.createElement('div');
    div.id = 'mount-x';
    dom.window.document.body.appendChild(div);
    try {
        const el = requireElement('mount-x');
        assert.equal(el.id, 'mount-x');
    } finally {
        div.remove();
    }
});

test('requireElement throws with the missing ID in the error message', () => {
    // No matching element in the DOM.
    assert.throws(
        () => requireElement('worktree-root'),
        /required element #worktree-root not found/,
    );
});

test('requireElement error mentions shell-assets MOUNT_POINTS so future debuggers know which file to fix', () => {
    let caught: Error | undefined;
    try {
        requireElement('this-id-was-never-defined');
    } catch (e) {
        caught = e as Error;
    }
    assert.ok(caught, 'expected requireElement to throw');
    assert.match(caught!.message, /MOUNT_POINTS/);
    assert.match(caught!.message, /this-id-was-never-defined/);
});
