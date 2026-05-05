/**
 * Loop 24 — pin scan's path-containment contract.
 *
 * Loop 04: `scanFile` (and by extension `scanFolder` / `scanFolderRecursive`)
 * now takes `(ctx, request)`. Path containment is enforced by `ctx.io`,
 * which is built once via `createWorkspaceContext`. Two attacks must
 * surface as `PathEscapeError`:
 *
 *   1. textual escape — caller passes a path like `'../escape.ts'`.
 *   2. realpath escape — caller passes a path that is textually inside the
 *      workspace but resolves outside via a symlink (POSIX-only; Windows
 *      symlink creation requires admin / Developer Mode and is skipped).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { scanFile } from '../../../src/application/scan';
import { createWorkspaceContext } from '../../../src/application/workspace-context';

test('scanFile: rejects PathEscape via .. arg', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-scan-'));
    const artifactDir = path.join(root, '.artifacts');
    fs.mkdirSync(artifactDir, { recursive: true });
    try {
        const ctx = await createWorkspaceContext({ workspaceRoot: root });
        await assert.rejects(
            scanFile(ctx, { filePath: '../escape.ts' }),
            (err: Error & { code?: string }) =>
                err.name === 'PathEscapeError' && err.code === 'PATH_ESCAPE',
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('scanFile: rejects symlink-target-outside-workspace (POSIX only)', async (t) => {
    if (process.platform === 'win32') {
        t.skip('Symlink test skipped on Windows; POSIX CI covers it.');
        return;
    }
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-scan-symlink-'));
    try {
        const root = path.join(parent, 'workspace');
        const outside = path.join(parent, 'outside');
        fs.mkdirSync(root, { recursive: true });
        fs.mkdirSync(outside, { recursive: true });
        fs.writeFileSync(path.join(outside, 'secret.ts'), 'export const x = 1;');
        fs.mkdirSync(path.join(root, '.artifacts'), { recursive: true });
        try {
            fs.symlinkSync(outside, path.join(root, 'leak'), 'dir');
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'EPERM' || code === 'EACCES') {
                t.skip(`Symlink creation failed (${code}; insufficient privileges).`);
                return;
            }
            throw err;
        }
        const ctx = await createWorkspaceContext({ workspaceRoot: root });
        await assert.rejects(
            scanFile(ctx, { filePath: 'leak/secret.ts' }),
            (err: Error & { code?: string }) =>
                err.name === 'PathEscapeError' && err.code === 'PATH_ESCAPE',
        );
    } finally {
        fs.rmSync(parent, { recursive: true, force: true });
    }
});
