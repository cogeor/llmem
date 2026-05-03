// tests/unit/workspace/workspace-io.test.ts
//
// Loop 23 — pin the WorkspaceIO contract: realpath-based containment for
// every read/write/list. The class layers `fs.realpath` on top of textual
// containment to defeat symlink-target-outside-root attacks that the L22
// helpers (textual only) explicitly leave open.
//
// Tests use real temp dirs (os.tmpdir + fs.mkdtempSync); each test cleans
// up in finally. The symlink case skips on Windows non-elevated.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { WorkspaceIO, createWorkspaceIO } from '../../../src/workspace/workspace-io';
import { asWorkspaceRoot } from '../../../src/core/paths';

function mkTmp(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rm(p: string): void {
    fs.rmSync(p, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

test('WorkspaceIO.create: non-existent root throws WorkspaceNotFoundError', async () => {
    const parent = mkTmp('llmem-io-');
    try {
        const ghost = path.join(parent, 'does-not-exist');
        await assert.rejects(
            WorkspaceIO.create(asWorkspaceRoot(ghost)),
            (err: Error & { code?: string }) => {
                assert.equal(err.name, 'WorkspaceNotFoundError');
                assert.equal(err.code, 'WORKSPACE_NOT_FOUND');
                return true;
            },
        );
    } finally {
        rm(parent);
    }
});

test('WorkspaceIO.create: getRealRoot returns canonical realpath of the root', async () => {
    const parent = mkTmp('llmem-io-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        assert.equal(io.getRealRoot(), fs.realpathSync(root));
    } finally {
        rm(parent);
    }
});

test('createWorkspaceIO factory mirrors WorkspaceIO.create', async () => {
    const parent = mkTmp('llmem-io-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const io = await createWorkspaceIO(asWorkspaceRoot(root));
        assert.equal(io.getRealRoot(), fs.realpathSync(root));
    } finally {
        rm(parent);
    }
});

// ---------------------------------------------------------------------------
// readFile
// ---------------------------------------------------------------------------

test('readFile: happy path reads UTF-8 contents', async () => {
    const parent = mkTmp('llmem-io-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        fs.writeFileSync(path.join(root, 'foo.txt'), 'hello world');
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        const content = await io.readFile('foo.txt');
        assert.equal(content, 'hello world');
    } finally {
        rm(parent);
    }
});

test('readFile: ../ escape throws PathEscapeError', async () => {
    const parent = mkTmp('llmem-io-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        await assert.rejects(
            io.readFile('../escape.txt'),
            (err: Error & { code?: string }) => {
                assert.equal(err.name, 'PathEscapeError');
                assert.equal(err.code, 'PATH_ESCAPE');
                return true;
            },
        );
    } finally {
        rm(parent);
    }
});

test('readFile: absolute path on a sibling directory throws PathEscapeError', async () => {
    const parent = mkTmp('llmem-io-');
    try {
        const root = path.join(parent, 'workspace');
        const sibling = path.join(parent, 'sibling');
        fs.mkdirSync(root);
        fs.mkdirSync(sibling);
        fs.writeFileSync(path.join(sibling, 'secret.txt'), 'nope');
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        await assert.rejects(
            io.readFile(path.join(sibling, 'secret.txt')),
            (err: Error) => err.name === 'PathEscapeError',
        );
    } finally {
        rm(parent);
    }
});

test('readFile: symlink-target-outside-root throws PathEscapeError via realpath', async (t) => {
    if (process.platform === 'win32') {
        t.skip(
            'Symlink test skipped on Windows (requires admin / Developer Mode); ' +
                'POSIX CI runs cover the realpath-containment contract.',
        );
        return;
    }
    const parent = mkTmp('llmem-io-symlink-');
    try {
        const root = path.join(parent, 'workspace');
        const outside = path.join(parent, 'outside');
        fs.mkdirSync(root);
        fs.mkdirSync(outside);
        fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
        try {
            // `leak` is a symlink inside the workspace pointing at the
            // outside dir. Textual containment of `leak/secret.txt` PASSES
            // (the entry name `leak` lives inside the workspace), but the
            // realpath of `leak/secret.txt` is `<parent>/outside/secret.txt`
            // — outside `realRoot`. The realpath check must catch this.
            fs.symlinkSync(outside, path.join(root, 'leak'), 'dir');
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'EPERM' || code === 'EACCES') {
                t.skip(
                    `Symlink creation failed (${code}; likely insufficient privileges). ` +
                        'POSIX CI covers this case.',
                );
                return;
            }
            throw err;
        }
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        await assert.rejects(
            io.readFile('leak/secret.txt'),
            (err: Error & { code?: string }) => {
                assert.equal(err.name, 'PathEscapeError');
                assert.equal(err.code, 'PATH_ESCAPE');
                return true;
            },
            'WorkspaceIO must block symlink-target-outside-workspace via realpath.',
        );
    } finally {
        rm(parent);
    }
});

test('readFile: null encoding returns Buffer', async () => {
    const parent = mkTmp('llmem-io-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        fs.writeFileSync(path.join(root, 'bin.dat'), Buffer.from([0xde, 0xad, 0xbe, 0xef]));
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        const buf = await io.readFile('bin.dat', null);
        assert.ok(Buffer.isBuffer(buf));
        assert.equal(buf.length, 4);
        assert.equal(buf[0], 0xde);
    } finally {
        rm(parent);
    }
});

// ---------------------------------------------------------------------------
// writeFile + mkdirRecursive
// ---------------------------------------------------------------------------

test('writeFile + mkdirRecursive: happy path creates not-yet-existing parent dir', async () => {
    const parent = mkTmp('llmem-io-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        await io.mkdirRecursive('a/b/c');
        await io.writeFile('a/b/c/x.txt', 'data');
        const content = fs.readFileSync(path.join(root, 'a', 'b', 'c', 'x.txt'), 'utf-8');
        assert.equal(content, 'data');
    } finally {
        rm(parent);
    }
});

test('writeFile: ../ escape throws PathEscapeError', async () => {
    const parent = mkTmp('llmem-io-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        await assert.rejects(
            io.writeFile('../escape.txt', 'nope'),
            (err: Error) => err.name === 'PathEscapeError',
        );
    } finally {
        rm(parent);
    }
});

test('mkdirRecursive: idempotent (second call does not throw)', async () => {
    const parent = mkTmp('llmem-io-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        await io.mkdirRecursive('sub/dir');
        await io.mkdirRecursive('sub/dir');
        assert.ok(fs.existsSync(path.join(root, 'sub', 'dir')));
    } finally {
        rm(parent);
    }
});

// ---------------------------------------------------------------------------
// exists
// ---------------------------------------------------------------------------

test('exists: returns true for present file, false for missing file', async () => {
    const parent = mkTmp('llmem-io-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        fs.writeFileSync(path.join(root, 'present.txt'), 'x');
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        assert.equal(await io.exists('present.txt'), true);
        assert.equal(await io.exists('missing.txt'), false);
    } finally {
        rm(parent);
    }
});

test('exists: ../ escape throws PathEscapeError (does NOT silently return false)', async () => {
    const parent = mkTmp('llmem-io-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        await assert.rejects(
            io.exists('../escape.txt'),
            (err: Error) => err.name === 'PathEscapeError',
        );
    } finally {
        rm(parent);
    }
});

// ---------------------------------------------------------------------------
// unlink
// ---------------------------------------------------------------------------

test('unlink: removes a file; second call rejects with ENOENT', async () => {
    const parent = mkTmp('llmem-io-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        fs.writeFileSync(path.join(root, 'doomed.txt'), 'bye');
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        await io.unlink('doomed.txt');
        assert.equal(fs.existsSync(path.join(root, 'doomed.txt')), false);
        await assert.rejects(
            io.unlink('doomed.txt'),
            (err: NodeJS.ErrnoException) => err.code === 'ENOENT',
        );
    } finally {
        rm(parent);
    }
});

// ---------------------------------------------------------------------------
// readDir / stat / lstat
// ---------------------------------------------------------------------------

test('readDir: lists entries of a directory', async () => {
    const parent = mkTmp('llmem-io-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        fs.writeFileSync(path.join(root, 'a.txt'), '');
        fs.writeFileSync(path.join(root, 'b.txt'), '');
        fs.mkdirSync(path.join(root, 'sub'));
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        const entries = (await io.readDir('.')).sort();
        assert.deepEqual(entries, ['a.txt', 'b.txt', 'sub']);
    } finally {
        rm(parent);
    }
});

test('stat: returns size of a file', async () => {
    const parent = mkTmp('llmem-io-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        fs.writeFileSync(path.join(root, 'x.txt'), 'hello');
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        const st = await io.stat('x.txt');
        assert.equal(st.size, 5);
    } finally {
        rm(parent);
    }
});

test('lstat: detects a symlink without following it (POSIX-only)', async (t) => {
    if (process.platform === 'win32') {
        t.skip('lstat-symlink test skipped on Windows; POSIX CI covers it.');
        return;
    }
    const parent = mkTmp('llmem-io-lstat-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        fs.writeFileSync(path.join(root, 'real.txt'), 'real');
        try {
            fs.symlinkSync('real.txt', path.join(root, 'link.txt'), 'file');
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'EPERM' || code === 'EACCES') {
                t.skip(`Symlink creation failed (${code}).`);
                return;
            }
            throw err;
        }
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        const st = await io.lstat('link.txt');
        assert.equal(st.isSymbolicLink(), true);
    } finally {
        rm(parent);
    }
});
