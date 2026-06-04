/**
 * LS-05 — scan-manifest sidecar (read / diff / write).
 *
 * Pins:
 *   - diffManifest classifies new / changed / deleted on a synthetic fsStats
 *     map, scoped to a subtree prefix, with size as the mtime tie-breaker.
 *   - JSON round-trips through writeManifest → readManifest over a real
 *     temp-dir WorkspaceIO / ctx.
 *   - a MISSING manifest → empty (everything-new), no throw.
 *   - a CORRUPT manifest (garbage bytes) → empty, no throw.
 *   - the manifest path is derived from ctx.artifactRoot (default
 *     `.llmem/graph`), not a hardcoded literal.
 *   - writeManifest uses writeFileAtomic so a prior valid manifest survives.
 *
 * Mirrors the temp-dir ctx pattern in scan-filters.test.ts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    readManifest,
    writeManifest,
    diffManifest,
    type Manifest,
    type FsStat,
} from '../../../src/application/scan-manifest';
import {
    createWorkspaceContext,
    type WorkspaceContext,
} from '../../../src/application/workspace-context';

function makeRoot(): string {
    return fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-manifest-')),
    );
}

async function ctxFor(root: string): Promise<WorkspaceContext> {
    const ctx = await createWorkspaceContext({ workspaceRoot: root });
    // writeFileAtomic does not mkdir parents; create the artifact root.
    fs.mkdirSync(ctx.artifactRoot, { recursive: true });
    return ctx;
}

function manifest(files: Manifest['files']): Manifest {
    return { version: 1, files };
}

// --------------------------------------------------------------------------
// diffManifest (pure)
// --------------------------------------------------------------------------

test('diffManifest classifies new / changed / deleted', () => {
    const m = manifest({
        'src/keep.ts': { mtimeMs: 100, size: 10, lines: 5, status: 'parsed' },
        'src/touch.ts': { mtimeMs: 100, size: 10, lines: 5, status: 'parsed' },
        'src/gone.ts': { mtimeMs: 100, size: 10, lines: 5, status: 'parsed' },
    });
    const fsStats: Record<string, FsStat> = {
        'src/keep.ts': { mtimeMs: 100, size: 10 },   // unchanged
        'src/touch.ts': { mtimeMs: 200, size: 10 },  // mtime differs → changed
        'src/new.ts': { mtimeMs: 50, size: 3 },      // new
    };
    const d = diffManifest(m, fsStats, 'src');
    assert.deepEqual(d.new, ['src/new.ts']);
    assert.deepEqual(d.changed, ['src/touch.ts']);
    assert.deepEqual(d.deleted, ['src/gone.ts']);
});

test('diffManifest uses size as the mtime tie-breaker', () => {
    const m = manifest({
        'a.ts': { mtimeMs: 100, size: 10, lines: 5, status: 'parsed' },
    });
    // Same mtime, different size → changed.
    const d = diffManifest(m, { 'a.ts': { mtimeMs: 100, size: 99 } }, '');
    assert.deepEqual(d.changed, ['a.ts']);
    assert.deepEqual(d.new, []);
    assert.deepEqual(d.deleted, []);
});

test('diffManifest scopes to the subtree prefix on both sides', () => {
    const m = manifest({
        'src/a.ts': { mtimeMs: 1, size: 1, lines: 1, status: 'parsed' },
        'lib/b.ts': { mtimeMs: 1, size: 1, lines: 1, status: 'parsed' },
    });
    const fsStats: Record<string, FsStat> = {
        'lib/c.ts': { mtimeMs: 1, size: 1 },
    };
    // Only `lib/` is in scope: src/a.ts (outside) is NOT reported deleted.
    const d = diffManifest(m, fsStats, 'lib');
    assert.deepEqual(d.new, ['lib/c.ts']);
    assert.deepEqual(d.deleted, ['lib/b.ts']);
    assert.deepEqual(d.changed, []);
});

test('diffManifest prefix is boundary-aware (src/a does not match src/ab)', () => {
    const m = manifest({
        'src/ab/x.ts': { mtimeMs: 1, size: 1, lines: 1, status: 'parsed' },
    });
    const d = diffManifest(m, {}, 'src/a');
    // src/ab/x.ts is NOT under src/a → not reported deleted.
    assert.deepEqual(d.deleted, []);
});

// --------------------------------------------------------------------------
// read / write round-trip + tolerance
// --------------------------------------------------------------------------

test('writeManifest → readManifest round-trips', async () => {
    const root = makeRoot();
    const ctx = await ctxFor(root);
    const m = manifest({
        'src/x.ts': { mtimeMs: 123, size: 45, lines: 6, status: 'parsed' },
        'src/y.d.ts': { mtimeMs: 1, size: 2, lines: 0, status: 'skipped-denylist' },
    });
    await writeManifest(ctx, m);
    const back = await readManifest(ctx);
    assert.deepEqual(back, m);
});

test('manifest path derives from ctx.artifactRoot (default .llmem/graph)', async () => {
    const root = makeRoot();
    const ctx = await ctxFor(root);
    await writeManifest(ctx, manifest({}));
    const onDisk = path.join(ctx.artifactRoot, 'scan-manifest.json');
    assert.ok(fs.existsSync(onDisk), 'manifest should land under the artifact root');
});

test('readManifest tolerates a MISSING manifest (everything-new)', async () => {
    const root = makeRoot();
    const ctx = await ctxFor(root);
    const m = await readManifest(ctx);
    assert.deepEqual(m, { version: 1, files: {} });
});

test('readManifest tolerates a CORRUPT manifest without throwing', async () => {
    const root = makeRoot();
    const ctx = await ctxFor(root);
    fs.writeFileSync(
        path.join(ctx.artifactRoot, 'scan-manifest.json'),
        '{ this is not valid json ]]',
    );
    const m = await readManifest(ctx);
    assert.deepEqual(m, { version: 1, files: {} });
});

test('writeManifest replaces a prior manifest atomically (prior survives intact)', async () => {
    const root = makeRoot();
    const ctx = await ctxFor(root);
    const first = manifest({
        'a.ts': { mtimeMs: 1, size: 1, lines: 1, status: 'parsed' },
    });
    await writeManifest(ctx, first);
    const second = manifest({
        'b.ts': { mtimeMs: 2, size: 2, lines: 2, status: 'error' },
    });
    await writeManifest(ctx, second);
    const back = await readManifest(ctx);
    assert.deepEqual(back, second);
    // No stray temp files left behind.
    const leftover = fs
        .readdirSync(ctx.artifactRoot)
        .filter((f) => f.includes('.tmp-'));
    assert.deepEqual(leftover, []);
});
