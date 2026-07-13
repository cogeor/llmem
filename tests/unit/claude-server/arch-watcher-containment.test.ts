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
 *
 * Loop 04: `ArchWatcherService` now takes a `WorkspaceContext` instead of
 * `(workspaceRoot, io)`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ArchWatcherService } from '../../../src/http-server/arch-watcher';
import { createWorkspaceContext } from '../../../src/application/workspace-context';

test('arch-watcher: writeDoc rejects ../escape', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-arch-cont-'));
    fs.mkdirSync(path.join(root, '.arch'), { recursive: true });
    try {
        const ctx = await createWorkspaceContext({ workspaceRoot: root });
        const watcher = new ArchWatcherService(ctx);
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
        const ctx = await createWorkspaceContext({ workspaceRoot: root });
        const watcher = new ArchWatcherService(ctx);
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
        fs.mkdirSync(root, { recursive: true });
        fs.mkdirSync(outside, { recursive: true });
        fs.writeFileSync(path.join(outside, 'secret.md'), '# secret');

        // Build the context first so the symlink is planted in the ACTUAL docs
        // root that readDoc reads (ctx.docsRoot = .llmem/docs). This test used
        // to seed `.arch` and lean on createWorkspaceContext migrating it into
        // the docs tree; migration is now a separate host-startup step
        // (initWorkspaceContext), so the containment check targets the docs
        // root directly instead of depending on the migration side effect.
        const ctx = await createWorkspaceContext({ workspaceRoot: root });
        fs.mkdirSync(ctx.docsRoot, { recursive: true });
        try {
            fs.symlinkSync(outside, path.join(ctx.docsRoot, 'leak'), 'dir');
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'EPERM' || code === 'EACCES') {
                t.skip(`Symlink creation failed (${code}; insufficient privileges).`);
                return;
            }
            throw err;
        }
        const watcher = new ArchWatcherService(ctx);
        await assert.rejects(
            watcher.readDoc('leak/secret'),
            (err: Error & { code?: string }) =>
                err.name === 'PathEscapeError' && err.code === 'PATH_ESCAPE',
        );
    } finally {
        fs.rmSync(parent, { recursive: true, force: true });
    }
});
