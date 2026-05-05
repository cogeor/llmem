// tests/unit/application/workspace-context.test.ts
//
// Loop 03 — pin the WorkspaceContext factory contract:
//   1. construction (loose / loose+overrides / resolved arities)
//   2. root containment (artifactRoot, archRoot)
//   3. relpath helpers (getArtifactRootRel / getArchRootRel /
//      resolveArtifactPath / resolveArchPath, with escape rejection)
//   4. rejection paths (missing root, mismatched io.getRealRoot,
//      symlink-realpath normalization)
//   5. defaultRuntimeConfig shape
//
// Tests use real temp dirs (os.tmpdir + fs.mkdtempSync); each test
// cleans up in finally. The symlink case skips on Windows non-elevated.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    createWorkspaceContext,
    defaultRuntimeConfig,
    getArtifactRootRel,
    getArchRootRel,
    resolveArtifactPath,
    resolveArchPath,
} from '../../../src/application/workspace-context';
import { WorkspaceIO } from '../../../src/workspace/workspace-io';
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

test('createWorkspaceContext (loose): builds a context with default config', async () => {
    const parent = mkTmp('llmem-ctx-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const ctx = await createWorkspaceContext({ workspaceRoot: root });
        assert.equal(ctx.config.artifactRoot, '.artifacts');
        assert.equal(ctx.config.maxFilesPerFolder, 20);
        assert.equal(ctx.config.maxFileSizeKB, 512);
        assert.equal(ctx.workspaceRoot, fs.realpathSync(root));
    } finally {
        rm(parent);
    }
});

test('createWorkspaceContext (loose): respects configOverrides', async () => {
    const parent = mkTmp('llmem-ctx-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const ctx = await createWorkspaceContext({
            workspaceRoot: root,
            configOverrides: { artifactRoot: 'custom-art' },
        });
        assert.equal(ctx.config.artifactRoot, 'custom-art');
        assert.ok(
            ctx.artifactRoot.endsWith('custom-art'),
            `expected artifactRoot to end with 'custom-art', got '${ctx.artifactRoot}'`,
        );
        assert.equal(ctx.artifactRootRel, 'custom-art');
    } finally {
        rm(parent);
    }
});

test('createWorkspaceContext (resolved): accepts pre-built io + config', async () => {
    const parent = mkTmp('llmem-ctx-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const realRoot = fs.realpathSync(root);
        const io = await WorkspaceIO.create(asWorkspaceRoot(realRoot));
        const config = defaultRuntimeConfig();
        const ctx = await createWorkspaceContext({
            workspaceRoot: asWorkspaceRoot(realRoot),
            config,
            io,
        });
        assert.equal(ctx.io, io);
        assert.equal(ctx.config, config);
        assert.equal(ctx.workspaceRoot, realRoot);
    } finally {
        rm(parent);
    }
});

// ---------------------------------------------------------------------------
// Root containment
// ---------------------------------------------------------------------------

test('createWorkspaceContext: artifactRoot is contained under workspaceRoot', async () => {
    const parent = mkTmp('llmem-ctx-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const ctx = await createWorkspaceContext({ workspaceRoot: root });
        const rel = path.relative(ctx.workspaceRoot, ctx.artifactRoot);
        assert.ok(
            !rel.startsWith('..') && !path.isAbsolute(rel),
            `expected artifactRoot under workspaceRoot, got rel='${rel}'`,
        );
    } finally {
        rm(parent);
    }
});

test('createWorkspaceContext: archRoot is contained under workspaceRoot and archRootRel === ".arch"', async () => {
    const parent = mkTmp('llmem-ctx-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const ctx = await createWorkspaceContext({ workspaceRoot: root });
        const rel = path.relative(ctx.workspaceRoot, ctx.archRoot);
        assert.ok(
            !rel.startsWith('..') && !path.isAbsolute(rel),
            `expected archRoot under workspaceRoot, got rel='${rel}'`,
        );
        assert.equal(ctx.archRootRel, '.arch');
    } finally {
        rm(parent);
    }
});

// ---------------------------------------------------------------------------
// Relpath helpers
// ---------------------------------------------------------------------------

test('getArtifactRootRel returns ctx.artifactRootRel', async () => {
    const parent = mkTmp('llmem-ctx-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const ctx = await createWorkspaceContext({ workspaceRoot: root });
        assert.equal(getArtifactRootRel(ctx), ctx.artifactRootRel);
        // Default: '.artifacts'.
        assert.equal(getArtifactRootRel(ctx), '.artifacts');
    } finally {
        rm(parent);
    }
});

test('getArchRootRel returns ".arch"', async () => {
    const parent = mkTmp('llmem-ctx-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const ctx = await createWorkspaceContext({ workspaceRoot: root });
        assert.equal(getArchRootRel(ctx), '.arch');
    } finally {
        rm(parent);
    }
});

test('resolveArtifactPath: happy path resolves under artifactRoot; rejects ../ escape with PathEscapeError', async () => {
    const parent = mkTmp('llmem-ctx-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const ctx = await createWorkspaceContext({ workspaceRoot: root });
        const resolved = resolveArtifactPath(ctx, 'edge-list.json');
        assert.equal(resolved, path.join(ctx.artifactRoot, 'edge-list.json'));
        assert.throws(
            () => resolveArtifactPath(ctx, '../escape.json'),
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

test('resolveArchPath: happy path resolves under archRoot; rejects ../ escape with PathEscapeError', async () => {
    const parent = mkTmp('llmem-ctx-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const ctx = await createWorkspaceContext({ workspaceRoot: root });
        const resolved = resolveArchPath(ctx, 'src/parser.md');
        assert.equal(resolved, path.join(ctx.archRoot, 'src/parser.md'));
        assert.throws(
            () => resolveArchPath(ctx, '../leak.md'),
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

// ---------------------------------------------------------------------------
// Rejection paths
// ---------------------------------------------------------------------------

test('createWorkspaceContext (loose): non-existent root throws WorkspaceNotFoundError', async () => {
    const parent = mkTmp('llmem-ctx-');
    try {
        const ghost = path.join(parent, 'does-not-exist');
        await assert.rejects(
            createWorkspaceContext({ workspaceRoot: ghost }),
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

test('createWorkspaceContext (resolved): mismatched io.getRealRoot throws WorkspaceNotFoundError', async () => {
    const parent = mkTmp('llmem-ctx-');
    try {
        const rootA = path.join(parent, 'workspace-a');
        const rootB = path.join(parent, 'workspace-b');
        fs.mkdirSync(rootA);
        fs.mkdirSync(rootB);
        const ioForA = await WorkspaceIO.create(asWorkspaceRoot(rootA));
        await assert.rejects(
            createWorkspaceContext({
                workspaceRoot: asWorkspaceRoot(fs.realpathSync(rootB)),
                config: defaultRuntimeConfig(),
                io: ioForA,
            }),
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

test('createWorkspaceContext (loose): symlink workspaceRoot gets normalized to realpath (POSIX-only)', async (t) => {
    if (process.platform === 'win32') {
        t.skip(
            'Symlink test skipped on Windows (requires admin / Developer Mode); ' +
                'POSIX CI runs cover the realpath-normalization contract.',
        );
        return;
    }
    const parent = mkTmp('llmem-ctx-symlink-');
    try {
        const real = path.join(parent, 'real');
        fs.mkdirSync(real);
        const link = path.join(parent, 'link');
        try {
            fs.symlinkSync(real, link, 'dir');
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
        const ctx = await createWorkspaceContext({ workspaceRoot: link });
        assert.equal(ctx.workspaceRoot, fs.realpathSync(link));
        // artifactRoot / archRoot must resolve against the realpath form
        // — this is the macOS `/var → /private/var` normalization the
        // factory relies on for containment to hold.
        assert.ok(ctx.artifactRoot.startsWith(fs.realpathSync(link)));
        assert.ok(ctx.archRoot.startsWith(fs.realpathSync(link)));
    } finally {
        rm(parent);
    }
});

// ---------------------------------------------------------------------------
// defaultRuntimeConfig
// ---------------------------------------------------------------------------

test('defaultRuntimeConfig matches DEFAULT_CONFIG shape', () => {
    assert.deepEqual(defaultRuntimeConfig(), {
        artifactRoot: '.artifacts',
        maxFilesPerFolder: 20,
        maxFileSizeKB: 512,
    });
});
