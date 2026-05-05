// tests/integration/toggle-watch.test.ts
//
// Loop 09 integration test for the unified toggle-watch workflow.
//
// Before this loop, `extension/panel.ts::_handleToggleWatch` and the
// HTTP server's `/api/watch` handler each implemented "add a path to
// watch" / "remove it" with subtle differences. Loop 09 lifted both
// flows into `application/toggle-watch.ts` and pinned the contract
// here: regardless of the host (VS Code panel vs HTTP server), an
// add-then-remove cycle on the same path leaves the on-disk artifact
// state where it started.
//
// Loop 04: `addWatchedPath` / `removeWatchedPath` now take
// `(ctx, request)`. Tests build a single `WorkspaceContext` per
// invocation via `createWorkspaceContext` and reuse it across both
// phases of the cycle.
//
// The test sets up a tiny temp workspace with a couple of .ts files,
// drives `addWatchedPath` followed by `removeWatchedPath`, and asserts:
//   1. `addedFiles` is non-empty after add and the edge-list JSON has
//      grown.
//   2. `removedFiles` is non-empty after remove and the edge-list JSON
//      no longer has any nodes/edges referencing that folder.
//   3. The watch-state JSON (`worktree-state.json`) reflects the same.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    addWatchedPath,
    removeWatchedPath,
} from '../../src/application/toggle-watch';
import { asRelPath } from '../../src/core/paths';
import { createWorkspaceContext } from '../../src/application/workspace-context';

function makeTmp(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Build a tiny TypeScript workspace under `root`:
 *   src/a.ts -- exports a function `alpha`
 *   src/b.ts -- imports alpha from ./a and calls it
 * Returns the relative folder path the tests target.
 */
function seedWorkspace(root: string): string {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(
        path.join(root, 'src', 'a.ts'),
        'export function alpha(x: number): number { return x + 1; }\n',
        'utf-8',
    );
    fs.writeFileSync(
        path.join(root, 'src', 'b.ts'),
        "import { alpha } from './a';\nexport function beta(): number { return alpha(2); }\n",
        'utf-8',
    );
    // The artifact root must exist for the edge-list stores to write into.
    fs.mkdirSync(path.join(root, '.artifacts'), { recursive: true });
    return 'src';
}

interface EdgeListSnapshot {
    nodes: number;
    edges: number;
    nodeFiles: string[];
}

function readEdgeListSnapshot(artifactDir: string, filename: string): EdgeListSnapshot {
    const fp = path.join(artifactDir, filename);
    if (!fs.existsSync(fp)) return { nodes: 0, edges: 0, nodeFiles: [] };
    const data = JSON.parse(fs.readFileSync(fp, 'utf-8')) as {
        nodes: { fileId: string }[];
        edges: unknown[];
    };
    return {
        nodes: data.nodes.length,
        edges: data.edges.length,
        nodeFiles: data.nodes.map((n) => n.fileId),
    };
}

function readWatchState(artifactDir: string): string[] {
    const fp = path.join(artifactDir, 'worktree-state.json');
    if (!fs.existsSync(fp)) return [];
    const data = JSON.parse(fs.readFileSync(fp, 'utf-8')) as { watchedFiles?: string[] };
    return data.watchedFiles ?? [];
}

test('addWatchedPath populates edge lists and watch state for a folder', async () => {
    const tmpRoot = makeTmp('llmem-toggle-watch-add-');
    const artifactDir = path.join(tmpRoot, '.artifacts');
    try {
        const folder = seedWorkspace(tmpRoot);

        const ctx = await createWorkspaceContext({ workspaceRoot: tmpRoot });
        const result = await addWatchedPath(ctx, {
            targetPath: asRelPath(folder),
        });

        assert.equal(result.success, true, result.message);
        assert.ok(result.addedFiles.length >= 2, `expected >=2 added files, got ${result.addedFiles.length}`);
        assert.ok(
            result.addedFiles.some((p) => p.endsWith('a.ts')) &&
                result.addedFiles.some((p) => p.endsWith('b.ts')),
            'both seeded files must be in addedFiles',
        );

        // Edge lists must have at least one node per file (the file node).
        const importSnap = readEdgeListSnapshot(artifactDir, 'import-edgelist.json');
        const callSnap = readEdgeListSnapshot(artifactDir, 'call-edgelist.json');
        assert.ok(importSnap.nodes > 0, 'import-edgelist.json must have nodes after add');
        assert.ok(callSnap.nodes > 0, 'call-edgelist.json must have nodes after add');
        assert.ok(
            importSnap.nodeFiles.some((f) => f.startsWith('src/')),
            'edge list must contain nodes under src/',
        );

        // Watch state must list both files.
        const watched = readWatchState(artifactDir);
        assert.ok(watched.includes('src/a.ts'), 'src/a.ts must be in watchedFiles');
        assert.ok(watched.includes('src/b.ts'), 'src/b.ts must be in watchedFiles');
        assert.deepEqual(
            new Set(result.watchedFiles),
            new Set(watched),
            'result.watchedFiles must match on-disk watchedFiles',
        );
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});

test('removeWatchedPath clears edge lists and watch state for the same folder', async () => {
    const tmpRoot = makeTmp('llmem-toggle-watch-cycle-');
    const artifactDir = path.join(tmpRoot, '.artifacts');
    try {
        const folder = seedWorkspace(tmpRoot);
        const ctx = await createWorkspaceContext({ workspaceRoot: tmpRoot });

        // Phase 1: add the folder.
        const addResult = await addWatchedPath(ctx, {
            targetPath: asRelPath(folder),
        });
        assert.equal(addResult.success, true, addResult.message);

        // Phase 2: remove the folder.
        const removeResult = await removeWatchedPath(ctx, {
            targetPath: asRelPath(folder),
        });
        assert.equal(removeResult.success, true, removeResult.message);
        assert.ok(removeResult.removedFiles.length >= 2, 'remove must report the watched files dropped');

        // After remove: no nodes under src/ in either edge list.
        const importSnap = readEdgeListSnapshot(artifactDir, 'import-edgelist.json');
        const callSnap = readEdgeListSnapshot(artifactDir, 'call-edgelist.json');
        assert.ok(
            !importSnap.nodeFiles.some((f) => f === 'src' || f.startsWith('src/')),
            `import-edgelist must not retain nodes under ${folder}; got ${importSnap.nodeFiles.join(', ')}`,
        );
        assert.ok(
            !callSnap.nodeFiles.some((f) => f === 'src' || f.startsWith('src/')),
            `call-edgelist must not retain nodes under ${folder}; got ${callSnap.nodeFiles.join(', ')}`,
        );

        // Watch state must be empty (nothing else was added).
        const watched = readWatchState(artifactDir);
        assert.equal(
            watched.length,
            0,
            `worktree-state.json watchedFiles must be empty after remove; got ${watched.join(', ')}`,
        );
        assert.equal(removeResult.watchedFiles.length, 0, 'result.watchedFiles must be empty after remove');
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});

test('addWatchedPath on a single file watches just that file', async () => {
    const tmpRoot = makeTmp('llmem-toggle-watch-file-');
    const artifactDir = path.join(tmpRoot, '.artifacts');
    try {
        seedWorkspace(tmpRoot);

        const ctx = await createWorkspaceContext({ workspaceRoot: tmpRoot });
        const result = await addWatchedPath(ctx, {
            targetPath: asRelPath('src/a.ts'),
        });

        assert.equal(result.success, true, result.message);
        assert.deepEqual(result.addedFiles, ['src/a.ts']);

        const watched = readWatchState(artifactDir);
        assert.deepEqual(watched, ['src/a.ts']);
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});

test('addWatchedPath rejects path-escape via PathEscapeError', async () => {
    const tmpRoot = makeTmp('llmem-toggle-watch-escape-');
    const artifactDir = path.join(tmpRoot, '.artifacts');
    try {
        fs.mkdirSync(artifactDir, { recursive: true });
        const ctx = await createWorkspaceContext({ workspaceRoot: tmpRoot });
        await assert.rejects(
            addWatchedPath(ctx, {
                targetPath: asRelPath('../../../etc/passwd'),
            }),
            (err: Error) => err.name === 'PathEscapeError',
            'A path that escapes the workspace must throw PathEscapeError',
        );
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});
