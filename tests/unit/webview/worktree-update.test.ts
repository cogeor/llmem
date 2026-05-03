// tests/unit/webview/worktree-update.test.ts
//
// Pin the contract that `generateWorkTree` returns a fresh snapshot of the
// filesystem on every call. The webview UI relies on this for incremental
// updates: when a watched file is added or deleted, the next call must
// reflect that change without any manual cache invalidation.
//
// Promoted from src/test/verify_tree_update.ts in Loop 17. The original
// script used a hardcoded directory next to itself and `process.exit(1)`
// for failure reporting; this version uses a temp dir and `assert.fail`.
//
// Loop 26: `generateWorkTree` now takes a `WorkspaceIO` instance.

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { generateWorkTree, type ITreeNode } from '../../../src/webview/worktree';
import { WorkspaceIO } from '../../../src/workspace/workspace-io';
import { asWorkspaceRoot } from '../../../src/core/paths';

describe('generateWorkTree add/remove cycle', () => {
    let testDir: string;
    let io: WorkspaceIO;

    before(async () => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-worktree-update-'));
        io = await WorkspaceIO.create(asWorkspaceRoot(testDir));
    });

    after(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    test('initial tree reflects the seeded structure', async () => {
        // Seed: file1.txt at root, sub/file2.txt nested.
        fs.writeFileSync(path.join(testDir, 'file1.txt'), 'content');
        fs.mkdirSync(path.join(testDir, 'sub'));
        fs.writeFileSync(path.join(testDir, 'sub', 'file2.txt'), 'content');

        const tree: ITreeNode = await generateWorkTree(io);

        const file1 = tree.children?.find((c) => c.name === 'file1.txt');
        const sub = tree.children?.find((c) => c.name === 'sub');
        const file2 = sub?.children?.find((c) => c.name === 'file2.txt');

        if (!file1) {
            assert.fail('Initial tree missing file1.txt');
        }
        if (!sub) {
            assert.fail('Initial tree missing sub/');
        }
        if (!file2) {
            assert.fail('Initial tree missing sub/file2.txt');
        }
    });

    test('adding a new file shows up in the next snapshot', async () => {
        fs.writeFileSync(path.join(testDir, 'newfile.txt'), 'content');

        const tree: ITreeNode = await generateWorkTree(io);

        const newFile = tree.children?.find((c) => c.name === 'newfile.txt');
        if (!newFile) {
            assert.fail('Updated tree missed the newly added file');
        }
    });

    test('removing a file drops it from the next snapshot', async () => {
        fs.unlinkSync(path.join(testDir, 'file1.txt'));

        const tree: ITreeNode = await generateWorkTree(io);

        const file1Gone = tree.children?.find((c) => c.name === 'file1.txt');
        if (file1Gone) {
            assert.fail('Updated tree still references the deleted file');
        }
    });
});
