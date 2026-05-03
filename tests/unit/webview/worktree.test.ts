// tests/unit/webview/worktree.test.ts
//
// Pin the contract that `generateWorkTree` precomputes the `isSupported`
// flag for every file node using `parser/config::isSupportedFile`. Loop 12
// moved this computation server-side so the browser-side Worktree component
// does not import `parser/config`. Loop 15 (parser-support-truth) deleted
// `.java`/`.go` from the supported-extension list — this test pins that the
// flag flips correctly, so unsupported files render but cannot be toggled
// for watching.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { generateWorkTree, type ITreeNode } from '../../../src/webview/worktree';

function findChild(root: ITreeNode, name: string): ITreeNode | undefined {
    return root.children?.find((c) => c.name === name);
}

test('generateWorkTree marks .java and .go files as not supported, .ts and .py as supported', async () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-worktree-test-'));
    try {
        // Build a minimal fixture. The contents are irrelevant for this test —
        // we are pinning the `isSupported` flag, not parser behaviour.
        fs.writeFileSync(path.join(fixtureDir, 'Foo.ts'), 'export const x = 1;\n');
        fs.writeFileSync(path.join(fixtureDir, 'Bar.java'), 'class Bar {}\n');
        fs.writeFileSync(path.join(fixtureDir, 'baz.go'), 'package main\n');
        fs.writeFileSync(path.join(fixtureDir, 'quux.py'), 'def quux():\n    pass\n');

        const tree = await generateWorkTree(fixtureDir);

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

        // Supported: .ts (TypeScript adapter) and .py (Python adapter).
        assert.equal(fooTs!.isSupported, true, 'Foo.ts must be marked supported');
        assert.equal(quuxPy!.isSupported, true, 'quux.py must be marked supported');

        // Unsupported: .java and .go have no adapter and were dropped from
        // ALL_SUPPORTED_EXTENSIONS in Loop 15.
        assert.equal(barJava!.isSupported, false, 'Bar.java must be marked NOT supported');
        assert.equal(bazGo!.isSupported, false, 'baz.go must be marked NOT supported');
    } finally {
        fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
});
