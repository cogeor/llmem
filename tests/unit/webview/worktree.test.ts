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
// registered) rather than the static extension list. The flags on each node
// are precomputed from `ParserRegistry.getSupport`, so the contract this test
// pins is that wiring — every node mirrors what the registry reports — plus the
// environment-independent anchors (`.ts` always supported; unknown extensions
// never supported). It deliberately does NOT hard-code absolute support for a
// grammar-gated extension like `.py`, whose parsability depends on whether the
// optional grammar happens to be installed.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { generateWorkTree, type ITreeNode } from '../../../src/application/viewer/worktree';
import { WorkspaceIO } from '../../../src/workspace/workspace-io';
import { asWorkspaceRoot } from '../../../src/core/paths';
import { IGNORED_FOLDERS } from '../../../src/parser/config';
import { ParserRegistry } from '../../../src/parser/registry';

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

        // The contract: every file node's support flags are precomputed from
        // ParserRegistry.getSupport. Assert that wiring directly so the test
        // holds whether or not optional grammars happen to be installed.
        const registry = ParserRegistry.getInstance();
        for (const name of ['Foo.ts', 'Bar.java', 'baz.go', 'quux.py']) {
            const node = findChild(tree, name);
            assert.ok(node, `${name} must appear in the tree`);
            const support = registry.getSupport(name);
            assert.equal(node!.isSupported, support.parsable, `${name} isSupported mirrors registry`);
            assert.equal(node!.needsGrammar, support.needsGrammar, `${name} needsGrammar mirrors registry`);
            assert.equal(node!.installHint, support.installHint, `${name} installHint mirrors registry`);
            assert.equal(node!.callGraph, support.callGraph, `${name} callGraph mirrors registry`);
        }

        // Environment-independent anchors:
        // .ts is always supported (built-in TS adapter, no grammar needed).
        const fooTs = findChild(tree, 'Foo.ts')!;
        assert.equal(fooTs.isSupported, true, 'Foo.ts must be marked supported');
        assert.equal(fooTs.needsGrammar, false, 'Foo.ts needs no grammar');
        assert.equal(fooTs.callGraph, 'semantic', 'Foo.ts has semantic call graph');

        // Unknown extensions: .java and .go have no adapter and are not in the
        // static supported list — never supported, never needs-grammar.
        for (const name of ['Bar.java', 'baz.go']) {
            const node = findChild(tree, name)!;
            assert.equal(node.isSupported, false, `${name} must be marked NOT supported`);
            assert.equal(node.needsGrammar, false, `${name} is unknown, not needs-grammar`);
        }
    } finally {
        fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
});

// PH-08: tree-walk line counting is no longer eager. `generateWorkTree` must
// NOT read each file's bytes during the walk just to count lines (that made
// generation O(repo-bytes)). lineCount is now a cheap size-based estimate, so
// the only `io.readFile` the walk performs is the single `.gitignore` read —
// never a per-file content read. This test counts `io.readFile` invocations and
// asserts the walk reads far fewer files than it visits (here: at most one).
test('generateWorkTree does NOT read file contents per file during the walk (PH-08)', async () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-worktree-noread-'));
    try {
        // Several text files the OLD walk would have read end-to-end (<1MB).
        for (let i = 0; i < 8; i++) {
            fs.writeFileSync(
                path.join(fixtureDir, `file${i}.ts`),
                `export const v${i} = ${i};\n// line two\n// line three\n`,
            );
        }
        // No .gitignore on purpose, so the ONLY legitimate readFile would be
        // gitignore (skipped because absent) — i.e. zero content reads expected.

        const io = await WorkspaceIO.create(asWorkspaceRoot(fixtureDir));

        // Spy on readFile, recording every relative path read during the walk.
        const reads: string[] = [];
        const origReadFile = io.readFile.bind(io);
        (io as unknown as { readFile: (...a: unknown[]) => unknown }).readFile = (
            ...args: unknown[]
        ) => {
            reads.push(String(args[0]));
            return (origReadFile as (...a: unknown[]) => unknown)(...args);
        };

        const tree = await generateWorkTree(io);

        // 8 files visited; the walk must read FAR fewer than once-per-file.
        // With no .gitignore present, expect zero content reads.
        assert.ok(
            reads.length <= 1,
            `walk must not read file contents per file; observed reads: ${JSON.stringify(reads)}`,
        );
        assert.ok(
            !reads.some((r) => /file\d\.ts$/.test(r)),
            `walk must not read any source file's bytes; observed reads: ${JSON.stringify(reads)}`,
        );

        // lineCount still present in the payload (size-based estimate, >= 1 for
        // a non-empty file) so the display field never goes missing.
        const f0 = findChild(tree, 'file0.ts');
        assert.ok(f0, 'file0.ts must appear in the tree');
        assert.equal(typeof f0!.lineCount, 'number', 'lineCount must remain a number in the payload');
        assert.ok((f0!.lineCount ?? 0) >= 1, 'non-empty file should estimate >= 1 line');
    } finally {
        fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
});

// PH-07: the explorer walk now uses the scanner's IGNORED_FOLDERS as the single
// source of truth (the old divergent ALWAYS_IGNORED omitted venvs/target/dist/
// build/.arch, so the tree rendered trees the scanner skipped). Every name in
// IGNORED_FOLDERS must be skipped, and .llmem (the centralized root) too.
test('generateWorkTree skips every IGNORED_FOLDERS name (unified ignore list)', async () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-worktree-ignore-'));
    try {
        // A real source file that must survive.
        fs.writeFileSync(path.join(fixtureDir, 'keep.ts'), 'export const x = 1;\n');

        // One nested file inside each ignored folder name; none should appear.
        for (const name of IGNORED_FOLDERS) {
            const dir = path.join(fixtureDir, name);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'inside.ts'), 'export const y = 2;\n');
        }

        const io = await WorkspaceIO.create(asWorkspaceRoot(fixtureDir));
        const tree = await generateWorkTree(io);

        assert.ok(findChild(tree, 'keep.ts'), 'keep.ts must survive the walk');
        for (const name of IGNORED_FOLDERS) {
            assert.equal(
                findChild(tree, name),
                undefined,
                `IGNORED_FOLDERS member ${name} must be skipped by the explorer walk`,
            );
        }
        // Spot-check the formerly-missing names the old ALWAYS_IGNORED dropped.
        for (const name of ['.venv', 'target', 'dist', 'build', '.arch', '.llmem']) {
            assert.ok(IGNORED_FOLDERS.has(name), `${name} must be in the shared ignore list`);
        }
    } finally {
        fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
});

// PH-08b: the .gitignore matcher is an APPROXIMATE subset (documented in
// parseGitignore/shouldIgnore). Pin the SUPPORTED patterns (*.ext, dir/*) and
// the documented LIMITATION that negation (!) is NOT honored.
test('generateWorkTree gitignore matcher: supported patterns prune; negation is not honored (PH-08b)', async () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-worktree-gitignore-'));
    try {
        fs.writeFileSync(path.join(fixtureDir, 'keep.ts'), 'export const x = 1;\n');
        fs.writeFileSync(path.join(fixtureDir, 'debug.log'), 'noise\n');
        fs.writeFileSync(path.join(fixtureDir, 'important.log'), 'still ignored\n');
        fs.mkdirSync(path.join(fixtureDir, 'gen'), { recursive: true });
        fs.writeFileSync(path.join(fixtureDir, 'gen', 'a.ts'), 'export const y = 2;\n');
        // *.log prunes both .log files; gen/* prunes the gen dir contents;
        // the negation !important.log is DROPPED by our matcher (documented).
        fs.writeFileSync(
            path.join(fixtureDir, '.gitignore'),
            '*.log\n!important.log\ngen/*\n',
        );

        const io = await WorkspaceIO.create(asWorkspaceRoot(fixtureDir));
        const tree = await generateWorkTree(io);

        assert.ok(findChild(tree, 'keep.ts'), 'keep.ts survives');
        // *.ext supported → both .log pruned (negation NOT honored — limitation).
        assert.equal(findChild(tree, 'debug.log'), undefined, '*.log prunes debug.log');
        assert.equal(
            findChild(tree, 'important.log'),
            undefined,
            'negation (!important.log) is NOT honored — file stays ignored (documented PH-08b limitation)',
        );
        // dir/* supported → gen's CONTENTS pruned (the dir entry itself remains,
        // empty — gen/* matches paths under gen/, not the bare 'gen' name).
        const gen = findChild(tree, 'gen');
        assert.ok(gen, 'gen directory entry remains');
        assert.equal(findChild(gen!, 'a.ts'), undefined, 'gen/* prunes gen/a.ts');
    } finally {
        fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
});
