// tests/unit/parser/languages.test.ts
//
// Pin the shape of the LANGUAGES descriptor array in src/parser/languages.ts.
//
// LANGUAGES is the single source of truth for supported languages: their ids,
// extensions, tree-sitter grammar packages, call-graph capability, and syntax
// highlight ids. These tests guard the invariants the registry/config/scan and
// python-callgraph migrations depend on:
//   - ids are unique,
//   - no extension is claimed by two languages,
//   - every declared grammarPackage matches a peerDependency in package.json,
//   - call-graph capabilities are exactly: ts 'semantic', py 'heuristic',
//     cpp/rust/r 'none'.
//
// Grammar-backed load()s are NOT invoked here (they would require the native
// grammar to be installed). Only the descriptor fields are asserted, plus the
// TypeScript load() which needs no grammar.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { LANGUAGES } from '../../../src/parser/languages';

function byId(id: string) {
    const desc = LANGUAGES.find((l) => l.id === id);
    assert.ok(desc, `expected a language descriptor with id "${id}"`);
    return desc!;
}

test('LANGUAGES has unique ids', () => {
    const ids = LANGUAGES.map((l) => l.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate id(s): ${ids.join(',')}`);
});

test('LANGUAGES claims each extension exactly once', () => {
    const seen = new Map<string, string>(); // ext -> owning language id
    for (const lang of LANGUAGES) {
        for (const ext of lang.extensions) {
            const prev = seen.get(ext);
            assert.ok(
                prev === undefined,
                `extension ${ext} claimed by both ${prev} and ${lang.id}`
            );
            seen.set(ext, lang.id);
        }
    }
});

test('every grammarPackage matches a peerDependency in package.json', () => {
    const pkgPath = path.resolve(__dirname, '../../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const peers = pkg.peerDependencies ?? {};

    for (const lang of LANGUAGES) {
        if (lang.grammarPackage === undefined) {
            continue;
        }
        assert.ok(
            Object.prototype.hasOwnProperty.call(peers, lang.grammarPackage),
            `grammarPackage "${lang.grammarPackage}" (language ${lang.id}) is not a peerDependency`
        );
    }
});

test('call-graph capabilities are correct per language', () => {
    assert.equal(byId('typescript').callGraph, 'semantic');
    assert.equal(byId('python').callGraph, 'heuristic');
    assert.equal(byId('cpp').callGraph, 'none');
    assert.equal(byId('rust').callGraph, 'none');
    assert.equal(byId('r').callGraph, 'none');
});

test('typescript has no grammarPackage; tree-sitter languages do', () => {
    assert.equal(byId('typescript').grammarPackage, undefined);
    assert.equal(byId('python').grammarPackage, 'tree-sitter-python');
    assert.equal(byId('cpp').grammarPackage, 'tree-sitter-cpp');
    assert.equal(byId('rust').grammarPackage, 'tree-sitter-rust');
    assert.equal(byId('r').grammarPackage, '@davisvaughan/tree-sitter-r');
});

test('highlight ids: base + per-extension overrides preserve .js/.jsx split', () => {
    const ts = byId('typescript');
    assert.equal(ts.highlightId, 'typescript');
    // Resolution rule: highlightOverrides[ext] ?? highlightId
    const resolve = (lang: typeof ts, ext: string) =>
        lang.highlightOverrides?.[ext] ?? lang.highlightId;
    assert.equal(resolve(ts, '.ts'), 'typescript');
    assert.equal(resolve(ts, '.tsx'), 'typescript');
    assert.equal(resolve(ts, '.js'), 'javascript');
    assert.equal(resolve(ts, '.jsx'), 'javascript');

    assert.equal(byId('python').highlightId, 'python');
    assert.equal(byId('cpp').highlightId, 'cpp');
    assert.equal(byId('rust').highlightId, 'rust');
    assert.equal(byId('r').highlightId, 'r');
});

test('typescript load() constructs an adapter without a grammar', () => {
    // TypeScript uses the compiler API, so load() needs no native grammar.
    const adapter = byId('typescript').load();
    assert.equal(adapter.id, 'typescript');
    assert.ok(Array.isArray(adapter.extensions) || typeof adapter.extensions === 'object');
});

test('no .dart entry exists', () => {
    assert.ok(!LANGUAGES.some((l) => l.id === 'dart'));
    assert.ok(!LANGUAGES.some((l) => l.extensions.includes('.dart')));
});
