// tests/unit/parser/config.test.ts
//
// Pin the static support-extension surface exported by `src/parser/config.ts`.
//
// Loop 15 (parser-support-truth) deleted the `.java` and `.go` entries from
// the advertised list because no adapter is registered for either at runtime.
// The list is now derived from the registered adapters' `.extensions` arrays
// plus `TYPESCRIPT_EXTENSIONS`. These tests guard against either:
//   - A future contributor re-adding `.java` / `.go` to placate the static list
//     without registering an adapter (today's exact failure mode).
//   - A future adapter dropping or renaming an extension without realising the
//     graph layer's external-vs-workspace classifier reads this list.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ALL_SUPPORTED_EXTENSIONS,
    isSupportedFile,
    getLanguageFromPath,
} from '../../../src/parser/config';

test('ALL_SUPPORTED_EXTENSIONS does not advertise unsupported languages (.java, .go)', () => {
    assert.ok(
        !ALL_SUPPORTED_EXTENSIONS.includes('.java'),
        'No Java adapter is registered; .java must not be advertised'
    );
    assert.ok(
        !ALL_SUPPORTED_EXTENSIONS.includes('.go'),
        'No Go adapter is registered; .go must not be advertised'
    );
});

test('ALL_SUPPORTED_EXTENSIONS contains exactly the expected set', () => {
    const expected = new Set([
        // TypeScript / JavaScript
        '.ts', '.tsx', '.js', '.jsx',
        // Python
        '.py',
        // C / C++
        '.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.hxx',
        // Rust
        '.rs',
        // R
        '.r', '.R',
    ]);
    const actual = new Set(ALL_SUPPORTED_EXTENSIONS);

    assert.equal(
        actual.size,
        expected.size,
        `extension count mismatch: actual=${[...actual].join(',')} expected=${[...expected].join(',')}`
    );
    for (const ext of expected) {
        assert.ok(actual.has(ext), `missing expected extension: ${ext}`);
    }
});

test('isSupportedFile returns false for .java files', () => {
    assert.equal(isSupportedFile('Foo.java'), false);
});

test('isSupportedFile returns false for .go files', () => {
    assert.equal(isSupportedFile('main.go'), false);
});

test('isSupportedFile returns true for .ts files', () => {
    assert.equal(isSupportedFile('Foo.ts'), true);
});

test('isSupportedFile returns true for .py files', () => {
    assert.equal(isSupportedFile('foo.py'), true);
});

test('getLanguageFromPath returns "code" (not "java") for .java files', () => {
    assert.equal(getLanguageFromPath('Foo.java'), 'code');
});

test('getLanguageFromPath returns "code" (not "go") for .go files', () => {
    assert.equal(getLanguageFromPath('main.go'), 'code');
});

test('getLanguageFromPath still returns real language IDs for supported files', () => {
    assert.equal(getLanguageFromPath('foo.ts'), 'typescript');
    assert.equal(getLanguageFromPath('foo.py'), 'python');
    assert.equal(getLanguageFromPath('foo.rs'), 'rust');
    assert.equal(getLanguageFromPath('foo.cpp'), 'cpp');
    assert.equal(getLanguageFromPath('foo.R'), 'r');
});
