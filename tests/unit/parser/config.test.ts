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
    isGeneratedFile,
    getCallGraphCapability,
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

test('getLanguageFromPath returns "code" (not "dart") for .dart files (ghost removed)', () => {
    assert.equal(getLanguageFromPath('Foo.dart'), 'code');
});

test('getLanguageFromPath still returns real language IDs for supported files', () => {
    assert.equal(getLanguageFromPath('foo.ts'), 'typescript');
    assert.equal(getLanguageFromPath('foo.py'), 'python');
    assert.equal(getLanguageFromPath('foo.rs'), 'rust');
    assert.equal(getLanguageFromPath('foo.cpp'), 'cpp');
    assert.equal(getLanguageFromPath('foo.R'), 'r');
});

// ----------------------------------------------------------------------------
// isGeneratedFile (LS-02): name-only denylist for machine-generated files.
// ----------------------------------------------------------------------------

test('isGeneratedFile matches the four denylist patterns', () => {
    assert.equal(isGeneratedFile('foo.min.js'), true);
    assert.equal(isGeneratedFile('a.bundle.css'), true);
    assert.equal(isGeneratedFile('x.generated.ts'), true);
    assert.equal(isGeneratedFile('types.d.ts'), true);
});

test('isGeneratedFile does not fire on plain source files', () => {
    assert.equal(isGeneratedFile('extractor.ts'), false);
    assert.equal(isGeneratedFile('index.js'), false);
    // Substring 'min' inside a name must NOT count as ".min." (segment-anchored).
    assert.equal(isGeneratedFile('terminal.ts'), false);
});

test('isGeneratedFile is case-insensitive and basename-only', () => {
    assert.equal(isGeneratedFile('Foo.MIN.JS'), true);
    assert.equal(isGeneratedFile('Types.D.TS'), true);
    // Directory segments must be ignored — only the basename is matched.
    assert.equal(isGeneratedFile('src/generated/extractor.ts'), false);
    assert.equal(isGeneratedFile('a/b/c.min.js'), true);
});

// PC-02: per-file call-graph capability derived from the LANGUAGES descriptor.
// 'semantic' (TS/JS), 'heuristic' (Python), 'none' (C/C++/Rust/R, unknown).
test('getCallGraphCapability: TS/JS are semantic', () => {
    assert.equal(getCallGraphCapability('src/a.ts'), 'semantic');
    assert.equal(getCallGraphCapability('src/a.tsx'), 'semantic');
    assert.equal(getCallGraphCapability('src/a.js'), 'semantic');
    assert.equal(getCallGraphCapability('src/a.jsx'), 'semantic');
});

test('getCallGraphCapability: Python is heuristic', () => {
    assert.equal(getCallGraphCapability('pkg/mod.py'), 'heuristic');
});

test('getCallGraphCapability: C/C++/Rust/R are none', () => {
    assert.equal(getCallGraphCapability('src/a.c'), 'none');
    assert.equal(getCallGraphCapability('src/a.cpp'), 'none');
    assert.equal(getCallGraphCapability('src/a.rs'), 'none');
    assert.equal(getCallGraphCapability('src/a.R'), 'none');
    assert.equal(getCallGraphCapability('src/a.r'), 'none');
});

test('getCallGraphCapability: unknown / no extension is none', () => {
    assert.equal(getCallGraphCapability('Foo.java'), 'none');
    assert.equal(getCallGraphCapability('Makefile'), 'none');
});
