// tests/integration/refresh-folder-graph.test.ts
//
// LS-06 integration coverage for refreshFolderGraph wired through
// buildDocumentFolderPrompt:
//   - cold workspace with NO artifact root → creates edges + manifest, no caveat
//   - edit a file → re-run reflects the change (edges updated)
//   - delete a file → its edges disappear next run
//   - over-line file → COVERAGE NOTES names it
//   - warm path (no edits) does NOT re-parse (edge-list file untouched)
//
// Run with the integration runner (--test-concurrency=1).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildDocumentFolderPrompt } from '../../src/application/document-folder';
import { asRelPath } from '../../src/core/paths';
import { createWorkspaceContext } from '../../src/application/workspace-context';

function makeTmp(prefix: string): string {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function write(root: string, rel: string, content: string): void {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
}

test('cold workspace (no artifact root): folder_info creates edges + manifest, no caveat', async () => {
    const tmpRoot = makeTmp('llmem-refresh-cold-');
    try {
        write(tmpRoot, 'src/demo/a.ts', `import { b } from './b';\nexport function a() { return b(); }\n`);
        write(tmpRoot, 'src/demo/b.ts', `export function b() { return 1; }\n`);

        const ctx = await createWorkspaceContext({ workspaceRoot: tmpRoot });

        // No artifact root exists yet — the old throw is gone; refresh creates it.
        const data = await buildDocumentFolderPrompt(ctx, {
            folderPath: asRelPath('src/demo'),
        });

        assert.ok(data.stats.edges > 0, 'cold run should produce edges');
        assert.ok(
            !data.prompt.includes('COVERAGE NOTES'),
            'a clean repo should have no coverage caveat',
        );

        // Artifact root + manifest were created on demand.
        const artDir = path.join(tmpRoot, '.llmem', 'graph');
        assert.ok(fs.existsSync(path.join(artDir, 'import-edgelist.json')), 'import edge list created');
        assert.ok(fs.existsSync(path.join(artDir, 'scan-manifest.json')), 'manifest created');

        const manifest = JSON.parse(fs.readFileSync(path.join(artDir, 'scan-manifest.json'), 'utf-8'));
        assert.ok(manifest.files['src/demo/a.ts'], 'manifest records a.ts');
        assert.ok(manifest.files['src/demo/b.ts'], 'manifest records b.ts');
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});

test('warm path: a second folder_info with no edits does NOT re-parse', async () => {
    const tmpRoot = makeTmp('llmem-refresh-warm-');
    try {
        write(tmpRoot, 'src/demo/a.ts', `export function a() { return 1; }\n`);
        const ctx = await createWorkspaceContext({ workspaceRoot: tmpRoot });

        await buildDocumentFolderPrompt(ctx, { folderPath: asRelPath('src/demo') });

        const edgeFile = path.join(tmpRoot, '.llmem', 'graph', 'import-edgelist.json');
        const mtime1 = fs.statSync(edgeFile).mtimeMs;

        // Second call with no FS changes: warm path returns after stat-walk +
        // empty diff, so the edge-list file must NOT be rewritten.
        const data2 = await buildDocumentFolderPrompt(ctx, { folderPath: asRelPath('src/demo') });
        const mtime2 = fs.statSync(edgeFile).mtimeMs;

        assert.equal(mtime2, mtime1, 'warm path must not rewrite the edge list (no re-parse)');
        assert.ok(data2.stats.nodes > 0, 'warm path still projects existing edges');
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});

test('edit a file: re-run reflects the change', async () => {
    const tmpRoot = makeTmp('llmem-refresh-edit-');
    try {
        write(tmpRoot, 'src/demo/a.ts', `export function alpha() { return 1; }\n`);
        const ctx = await createWorkspaceContext({ workspaceRoot: tmpRoot });

        const first = await buildDocumentFolderPrompt(ctx, { folderPath: asRelPath('src/demo') });
        assert.ok(
            first.rawEdges.length >= 0 && first.structuralMarkdown.includes('alpha'),
            'first run sees alpha',
        );

        // Edit: rename the function. Bump mtime to be safe across fast FS clocks.
        const abs = path.join(tmpRoot, 'src/demo/a.ts');
        write(tmpRoot, 'src/demo/a.ts', `export function beta() { return 2; }\n`);
        const future = new Date(Date.now() + 2000);
        fs.utimesSync(abs, future, future);

        const second = await buildDocumentFolderPrompt(ctx, { folderPath: asRelPath('src/demo') });
        assert.ok(second.structuralMarkdown.includes('beta'), 're-run reflects the renamed entity');
        assert.ok(!second.structuralMarkdown.includes('alpha'), 'stale entity gone after re-parse');
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});

test('delete a file: its edges disappear next run', async () => {
    const tmpRoot = makeTmp('llmem-refresh-delete-');
    try {
        write(tmpRoot, 'src/demo/a.ts', `import { b } from './b';\nexport function a() { return b(); }\n`);
        write(tmpRoot, 'src/demo/b.ts', `export function b() { return 1; }\n`);
        const ctx = await createWorkspaceContext({ workspaceRoot: tmpRoot });

        const first = await buildDocumentFolderPrompt(ctx, { folderPath: asRelPath('src/demo') });
        const aEdgesBefore = first.rawEdges.filter((e) =>
            e.source.replace(/\\/g, '/').startsWith('src/demo/a.ts'),
        );
        assert.ok(aEdgesBefore.length > 0, 'a.ts has source-side edges before deletion');

        fs.rmSync(path.join(tmpRoot, 'src/demo/a.ts'));

        const second = await buildDocumentFolderPrompt(ctx, { folderPath: asRelPath('src/demo') });
        const aEdgesAfter = second.rawEdges.filter((e) =>
            e.source.replace(/\\/g, '/').startsWith('src/demo/a.ts'),
        );
        assert.equal(aEdgesAfter.length, 0, "deleted file's source-side edges are gone");

        const manifest = JSON.parse(
            fs.readFileSync(path.join(tmpRoot, '.llmem', 'graph', 'scan-manifest.json'), 'utf-8'),
        );
        assert.ok(!manifest.files['src/demo/a.ts'], 'manifest no longer lists the deleted file');
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});

test('over-line file: COVERAGE NOTES names it', async () => {
    const tmpRoot = makeTmp('llmem-refresh-overline-');
    try {
        // A small normal file plus a file that exceeds the line gate.
        write(tmpRoot, 'src/demo/ok.ts', `export function ok() { return 1; }\n`);
        const bigLines = Array.from({ length: 50 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';
        write(tmpRoot, 'src/demo/big.ts', bigLines);

        const ctx = await createWorkspaceContext({
            workspaceRoot: tmpRoot,
            configOverrides: { maxFileLines: 10 },
        });

        const data = await buildDocumentFolderPrompt(ctx, { folderPath: asRelPath('src/demo') });
        assert.ok(data.prompt.includes('COVERAGE NOTES'), 'caveat block present');
        assert.ok(
            data.prompt.includes('src/demo/big.ts'),
            'the over-line file is named in the coverage notes',
        );
        assert.ok(
            data.prompt.includes('exceeds line limit (10)'),
            'caveat states the line limit reason',
        );
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});
