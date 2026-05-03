/**
 * Loop 26 — pin viewer-data's path-containment contract.
 *
 * `collectViewerData` now takes a required `WorkspaceIO` instance. Every
 * read-side `fs.*` site (existsSync × 3, readdirSync × 1) is replaced
 * with `WorkspaceIO` calls, and the recursive `.arch` walker is async.
 *
 * Two things must hold:
 *
 *   1. **Happy path** — a workspace with a tiny TS file and a `.arch/`
 *      markdown doc produces a `ViewerData` with the expected design-doc
 *      key, the seeded TS file in the worktree, and a valid (possibly
 *      empty) `importGraph` shape.
 *   2. **Realpath escape** — a symlink inside the workspace pointing
 *      OUTSIDE must surface as `PathEscapeError` when read directly via
 *      the io surface (POSIX-only; Windows symlink creation requires
 *      admin / Developer Mode and is skipped).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { WorkspaceIO } from '../../../src/workspace/workspace-io';
import { asWorkspaceRoot, asAbsPath } from '../../../src/core/paths';
import { collectViewerData } from '../../../src/application/viewer-data';
import { NoopLogger } from '../../../src/core/logger';

test('collectViewerData: returns the seeded TS file and design doc', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-viewer-data-'));
    try {
        // Seed a TS file at the root.
        fs.writeFileSync(path.join(root, 'sample.ts'), 'export const x = 1;\n');

        // Seed a tiny design doc under .arch/.
        const archDir = path.join(root, '.arch');
        fs.mkdirSync(archDir, { recursive: true });
        const docContent = '# Sample\n\nA tiny doc.\n';
        fs.writeFileSync(path.join(archDir, 'sample.md'), docContent);

        // Artifact root under the workspace.
        const artifactDir = path.join(root, '.artifacts');
        fs.mkdirSync(artifactDir, { recursive: true });

        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        const result = await collectViewerData({
            workspaceRoot: asWorkspaceRoot(root),
            artifactRoot: asAbsPath(artifactDir),
            io,
            logger: NoopLogger,
        });

        // Design doc: key is 'sample.html' (.md → .html for non-README).
        const designKeys = Object.keys(result.designDocs);
        assert.equal(designKeys.length, 1, 'expected exactly one design doc');
        const docKey = designKeys[0];
        assert.equal(docKey, 'sample.html', 'design-doc key must follow .md → .html');
        assert.equal(result.designDocs[docKey], docContent, 'markdown payload must round-trip unchanged');

        // Worktree: the seeded TS file must appear.
        assert.equal(result.workTree.type, 'directory');
        assert.ok(Array.isArray(result.workTree.children), 'worktree must have children');
        const sampleTs = result.workTree.children!.find((c) => c.name === 'sample.ts');
        assert.ok(sampleTs, 'sample.ts must appear in the worktree');
        assert.equal(sampleTs!.type, 'file');

        // Graph data: shape must be valid (importGraph and callGraph exist
        // with `nodes` and `edges` arrays). Edges may be empty for a
        // single-file workspace with no imports.
        assert.ok(result.graphData, 'graphData must be present');
        assert.ok(result.graphData.importGraph, 'importGraph must be present');
        assert.ok(Array.isArray(result.graphData.importGraph.nodes), 'importGraph.nodes must be an array');
        assert.ok(Array.isArray(result.graphData.importGraph.edges), 'importGraph.edges must be an array');
        assert.ok(result.graphData.callGraph, 'callGraph must be present');
        assert.ok(Array.isArray(result.graphData.callGraph.nodes), 'callGraph.nodes must be an array');
        assert.ok(Array.isArray(result.graphData.callGraph.edges), 'callGraph.edges must be an array');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('collectViewerData: refuses to traverse outside the workspace via symlink (POSIX only)', async (t) => {
    if (process.platform === 'win32') {
        t.skip('Symlink test skipped on Windows; POSIX CI covers realpath containment.');
        return;
    }
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-viewer-data-symlink-'));
    try {
        const root = path.join(parent, 'workspace');
        const outside = path.join(parent, 'outside');
        fs.mkdirSync(root, { recursive: true });
        fs.mkdirSync(outside, { recursive: true });
        fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');

        // Plant a symlink inside the workspace that points outside.
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

        // Also plant a legitimate doc and tiny TS file so collectViewerData
        // has something to do.
        fs.mkdirSync(path.join(root, '.arch'), { recursive: true });
        fs.writeFileSync(path.join(root, '.arch', 'good.md'), '# Good\n');
        fs.writeFileSync(path.join(root, 'main.ts'), 'export const y = 2;\n');
        fs.mkdirSync(path.join(root, '.artifacts'), { recursive: true });

        const io = await WorkspaceIO.create(asWorkspaceRoot(root));

        // Direct read through the leak symlink must throw PathEscapeError.
        await assert.rejects(
            io.readFile('leak/secret.txt'),
            (err: Error & { code?: string }) =>
                err.name === 'PathEscapeError' && err.code === 'PATH_ESCAPE',
            'WorkspaceIO must reject reads that traverse a symlink pointing outside the workspace.',
        );

        // collectViewerData must still succeed for the legitimate content
        // (the worktree walker is allowed to skip the offending entry — it
        // does not propagate PathEscapeError as a fatal failure for a
        // single bad subdir, mirroring the legacy walker's swallow-then-
        // continue behavior on stat failures).
        const result = await collectViewerData({
            workspaceRoot: asWorkspaceRoot(root),
            artifactRoot: asAbsPath(path.join(root, '.artifacts')),
            io,
            logger: NoopLogger,
        });
        assert.ok(result.designDocs['good.html'], 'legitimate design doc must round-trip');
    } finally {
        fs.rmSync(parent, { recursive: true, force: true });
    }
});
