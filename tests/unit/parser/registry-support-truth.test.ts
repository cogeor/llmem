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

// PH-04: getSupport reconciles static vs runtime support so the UI never
// advertises a live toggle for a file that can't actually be parsed.

test('getSupport.parsable agrees with getParser for a representative set', () => {
    const registry = ParserRegistry.getInstance();
    // getParser(filePath, workspaceRoot) returns an extractor or null.
    const root = process.cwd();
    const samples = ['foo.ts', 'foo.tsx', 'foo.js', 'foo.jsx', 'foo.py', 'Foo.java', 'main.go', 'README.md'];
    for (const f of samples) {
        assert.equal(
            registry.getSupport(f).parsable,
            registry.getParser(f, root) !== null,
            `parsable must match getParser for ${f}`
        );
    }
});

test('getSupport: .ts is parsable, no grammar needed, semantic call graph', () => {
    const s = ParserRegistry.getInstance().getSupport('foo.ts');
    assert.equal(s.parsable, true);
    assert.equal(s.needsGrammar, false);
    assert.equal(s.callGraph, 'semantic');
    assert.equal(s.installHint, undefined);
});

test('getSupport: .py with no grammar installed → needsGrammar + heuristic + tree-sitter-python hint', () => {
    // In this repo's node_modules only tree-sitter core is present; the
    // python grammar is NOT installed, so .py is genuinely needs-grammar.
    const registry = ParserRegistry.getInstance();
    // Guard the precondition so this stays correct if the grammar is ever added.
    if (registry.isSupported('foo.py')) {
        const s = registry.getSupport('foo.py');
        assert.equal(s.parsable, true);
        assert.equal(s.needsGrammar, false);
        return;
    }
    const s = registry.getSupport('foo.py');
    assert.equal(s.parsable, false);
    assert.equal(s.needsGrammar, true);
    assert.equal(s.installHint, 'tree-sitter-python');
    assert.equal(s.callGraph, 'heuristic');
});

test('getSupport: unknown extension → not parsable, no grammar, none call graph', () => {
    const s = ParserRegistry.getInstance().getSupport('main.go');
    assert.equal(s.parsable, false);
    assert.equal(s.needsGrammar, false);
    assert.equal(s.callGraph, 'none');
    assert.equal(s.installHint, undefined);
});
