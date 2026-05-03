// tests/unit/parser/registry-support-truth.test.ts
//
// Pin `ParserRegistry` as the runtime source of truth for parser-extension
// support. Loop 15 (parser-support-truth) made `parser/config.ts` derive its
// static list from the adapters' `.extensions` arrays; this test pins the
// other half of the contract — that the registry, when consulted at runtime,
// agrees with the static list on the negative cases (`.java`, `.go`) and on
// the always-on positives (`.ts`, `.tsx`, `.js`, `.jsx` from the TS adapter).
//
// It does NOT pin the Python / C++ / Rust / R extensions because those
// adapters depend on optional `tree-sitter-*` peerDependencies that may not be
// installed in every environment (notably this repo's local node_modules,
// where only `tree-sitter` core is present). The registry skips an adapter
// silently if its grammar package fails to load.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ParserRegistry } from '../../../src/parser/registry';

test('ParserRegistry.getSupportedExtensions returns a non-empty array', () => {
    const extensions = ParserRegistry.getInstance().getSupportedExtensions();
    assert.ok(Array.isArray(extensions), 'getSupportedExtensions must return an array');
    assert.ok(extensions.length > 0, 'registry must register at least the TS adapter');
});

test('ParserRegistry.getSupportedExtensions always includes TS/JS extensions', () => {
    const extensions = ParserRegistry.getInstance().getSupportedExtensions();
    // TypeScriptAdapter is registered unconditionally (no tree-sitter dep).
    assert.ok(extensions.includes('.ts'), '.ts must be registered');
    assert.ok(extensions.includes('.tsx'), '.tsx must be registered');
    assert.ok(extensions.includes('.js'), '.js must be registered');
    assert.ok(extensions.includes('.jsx'), '.jsx must be registered');
});

test('ParserRegistry.getSupportedExtensions does not include unsupported languages', () => {
    const extensions = ParserRegistry.getInstance().getSupportedExtensions();
    assert.ok(!extensions.includes('.java'), 'no Java adapter is registered');
    assert.ok(!extensions.includes('.go'), 'no Go adapter is registered');
});

test('ParserRegistry.isSupported returns false for .java files', () => {
    assert.equal(
        ParserRegistry.getInstance().isSupported('Foo.java'),
        false
    );
});

test('ParserRegistry.isSupported returns false for .go files', () => {
    assert.equal(
        ParserRegistry.getInstance().isSupported('main.go'),
        false
    );
});

test('ParserRegistry.isSupported returns true for .ts files', () => {
    assert.equal(
        ParserRegistry.getInstance().isSupported('foo.ts'),
        true
    );
});
