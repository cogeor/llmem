// tests/unit/webview/worktree.test.ts
//
// Pin the contract that `generateWorkTree` precomputes the `isSupported`
// flag for every file node using `parser/config::isSupportedFile`. Loop 12
// moved this computation server-side so the browser-side Worktree component
// does not import `parser/config`. Loop 15 (parser-support-truth) deleted
// `.java`/`.go` from the supported-extension list — this test pins that the
// flag flips correctly, so unsupported files render but cannot be toggled
// for watching.
//
// Loop 26: `generateWorkTree` now takes a `WorkspaceIO` instance instead
// of an absolute root path.
//
// PH-04: `isSupported` now reflects RUNTIME parsability (a parser is actually
// registered) rather than the static extension list. A known source extension
// whose tree-sitter grammar is not installed (e.g. `.py` in this repo's
// node_modules, which only ships the tree-sitter core) is `isSupported: false`
// + `needsGrammar: true` — it must NOT get a live (no-op) watch toggle.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { generateWorkTree, type ITreeNode } from '../../../src/webview/worktree';
import { WorkspaceIO } from '../../../src/workspace/workspace-io';
import { asWorkspaceRoot } from '../../../src/core/paths';

function findChild(root: ITreeNode, name: string): ITreeNode | undefined {
    return root.children?.find((c) => c.name === name);
}

test('generateWorkTree marks files supported iff a parser is registered at runtime', async () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-worktree-test-'));
    try {
        // Build a minimal fixture. The contents are irrelevant for this test —
        // we are pinning the `isSupported` flag, not parser behaviour.
        fs.writeFileSync(path.join(fixtureDir, 'Foo.ts'), 'export const x = 1;\n');
        fs.writeFileSync(path.join(fixtureDir, 'Bar.java'), 'class Bar {}\n');
        fs.writeFileSync(path.join(fixtureDir, 'baz.go'), 'package main\n');
        fs.writeFileSync(path.join(fixtureDir, 'quux.py'), 'def quux():\n    pass\n');

        const io = await WorkspaceIO.create(asWorkspaceRoot(fixtureDir));
        const tree = await generateWorkTree(io);

        assert.equal(tree.type, 'directory');
        assert.ok(Array.isArray(tree.children), 'root tree should have children');

        const fooTs = findChild(tree, 'Foo.ts');
        const barJava = findChild(tree, 'Bar.java');
        const bazGo = findChild(tree, 'baz.go');
        const quuxPy = findChild(tree, 'quux.py');

        assert.ok(fooTs, 'Foo.ts must appear in the tree');
        assert.ok(barJava, 'Bar.java must appear in the tree');
        assert.ok(bazGo, 'baz.go must appear in the tree');
        assert.ok(quuxPy, 'quux.py must appear in the tree');

        // Supported: .ts (TypeScript adapter, no grammar needed).
        assert.equal(fooTs!.isSupported, true, 'Foo.ts must be marked supported');
        assert.equal(fooTs!.needsGrammar, false, 'Foo.ts needs no grammar');
        assert.equal(fooTs!.callGraph, 'semantic', 'Foo.ts has semantic call graph');

        // PH-04: .py is a known source extension but its tree-sitter grammar is
        // not installed here → NOT runtime-parsable, needs-grammar instead.
        assert.equal(quuxPy!.isSupported, false, 'quux.py is not runtime-parsable without its grammar');
        assert.equal(quuxPy!.needsGrammar, true, 'quux.py must be marked needsGrammar');
        assert.equal(quuxPy!.installHint, 'tree-sitter-python', 'quux.py carries the install hint');
        assert.equal(quuxPy!.callGraph, 'heuristic', 'quux.py declares heuristic call graph');

        // Unknown extensions: .java and .go have no adapter and are not in the
        // static supported list — neither supported nor needs-grammar.
        assert.equal(barJava!.isSupported, false, 'Bar.java must be marked NOT supported');
        assert.equal(barJava!.needsGrammar, false, 'Bar.java is unknown, not needs-grammar');
        assert.equal(bazGo!.isSupported, false, 'baz.go must be marked NOT supported');
        assert.equal(bazGo!.needsGrammar, false, 'baz.go is unknown, not needs-grammar');
    } finally {
        fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
});
