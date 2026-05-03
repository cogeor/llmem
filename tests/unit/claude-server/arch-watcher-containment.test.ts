/**
 * Loop 24 — pin arch-watcher's path-containment contract.
 *
 * `ArchWatcherService.readDoc` / `writeDoc` previously used a textual-only
 * `assertInArchDir` check, which silently accepted symlink-target-outside-
 * workspace attacks. After L24:
 *
 *   1. textual escape (`../escape.md`) surfaces as `PathEscapeError` from
 *      the explicit `.arch/` prefix check.
 *   2. realpath escape (POSIX symlink under `.arch` to outside) surfaces
 *      as `PathEscapeError` from `WorkspaceIO`'s realpath layer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { WorkspaceIO } from '../../../src/workspace/workspace-io';
import { asWorkspaceRoot } from '../../../src/core/paths';
import { ArchWatcherService } from '../../../src/claude/server/arch-watcher';

test('arch-watcher: writeDoc rejects ../escape', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-arch-cont-'));
    fs.mkdirSync(path.join(root, '.arch'), { recursive: true });
    try {
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        const watcher = new ArchWatcherService({ workspaceRoot: root, io });
        await assert.rejects(
            watcher.writeDoc('../escape', '# pwn'),
            (err: Error & { code?: string }) =>
                err.name === 'PathEscapeError' && err.code === 'PATH_ESCAPE',
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('arch-watcher: readDoc rejects ../escape', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-arch-cont-'));
    fs.mkdirSync(path.join(root, '.arch'), { recursive: true });
    try {
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        const watcher = new ArchWatcherService({ workspaceRoot: root, io });
        await assert.rejects(
            watcher.readDoc('../escape'),
            (err: Error & { code?: string }) =>
                err.name === 'PathEscapeError' && err.code === 'PATH_ESCAPE',
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('arch-watcher: readDoc rejects symlink-target-outside-workspace (POSIX only)', async (t) => {
    if (process.platform === 'win32') {
        t.skip('Symlink test skipped on Windows; POSIX CI covers it.');
        return;
    }
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-arch-symlink-'));
    try {
        const root = path.join(parent, 'workspace');
        const outside = path.join(parent, 'outside');
        fs.mkdirSync(path.join(root, '.arch'), { recursive: true });
        fs.mkdirSync(outside, { recursive: true });
        fs.writeFileSync(path.join(outside, 'secret.md'), '# secret');
        try {
            fs.symlinkSync(outside, path.join(root, '.arch', 'leak'), 'dir');
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'EPERM' || code === 'EACCES') {
                t.skip(`Symlink creation failed (${code}; insufficient privileges).`);
                return;
            }
            throw err;
        }
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        const watcher = new ArchWatcherService({ workspaceRoot: root, io });
        await assert.rejects(
            watcher.readDoc('leak/secret'),
            (err: Error & { code?: string }) =>
                err.name === 'PathEscapeError' && err.code === 'PATH_ESCAPE',
        );
    } finally {
        fs.rmSync(parent, { recursive: true, force: true });
    }
});
