// tests/integration/refresh-content-hash.test.ts
//
// Loop 10 integration coverage for the CONTENT-HASH freshness key (retiring the
// mtime+size-only change detector) wired through buildDocumentFolderPrompt:
//   - touch (bump mtime, identical bytes) → WARM, no re-parse. Under the
//     retired mtime+size key this WOULD have re-parsed.
//   - a real content edit → COLD, re-parse.
//   - a legacy manifest with the `hash` field stripped → recompute once, no
//     crash, gains a hash.
//
// Mirrors the refresh-folder-graph.test.ts harness (tmp workspace +
// createWorkspaceContext + buildDocumentFolderPrompt; warm-vs-cold asserted via
// the import-edgelist.json mtime, correctness via structuralMarkdown).
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

const HEX64 = /^[0-9a-f]{64}$/;

test('touch (bump mtime, identical bytes) does NOT re-parse — the OLD mtime+size key WOULD have', async () => {
    const tmpRoot = makeTmp('llmem-hash-touch-');
    try {
        write(tmpRoot, 'src/demo/a.ts', `export function alpha() { return 1; }\n`);
        const ctx = await createWorkspaceContext({ workspaceRoot: tmpRoot });

        // First run seeds edges + a manifest WITH a content hash.
        await buildDocumentFolderPrompt(ctx, { folderPath: asRelPath('src/demo') });

        const graphDir = path.join(tmpRoot, '.llmem', 'graph');
        const importEdgeFile = path.join(graphDir, 'import-edgelist.json');
        const manifestFile = path.join(graphDir, 'scan-manifest.json');
        const mtime1 = fs.statSync(importEdgeFile).mtimeMs;

        // Strengthener: the first run persisted a 64-char hex hash.
        const m1 = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));
        assert.match(m1.files['src/demo/a.ts'].hash, HEX64, 'first run persists a content hash');

        // Bump mtime, SAME bytes (do NOT rewrite the file). Push it well past the
        // recorded mtime so the cheap pre-filter genuinely fires — this is exactly
        // the case the retired mtime+size key classified as `changed`.
        const abs = path.join(tmpRoot, 'src/demo/a.ts');
        const future = new Date(Date.now() + 5000);
        fs.utimesSync(abs, future, future);
        assert.notEqual(
            fs.statSync(abs).mtimeMs,
            m1.files['src/demo/a.ts'].mtimeMs,
            'fs mtime now differs from the manifest, so the pre-filter fires',
        );

        // Second run: under the retired mtime+size key this would have been
        // `changed` and re-parsed; the content hash keeps it WARM.
        await buildDocumentFolderPrompt(ctx, { folderPath: asRelPath('src/demo') });
        const mtime2 = fs.statSync(importEdgeFile).mtimeMs;

        assert.equal(mtime2, mtime1, 'touch-without-edit is WARM: edge list not rewritten (no re-parse)');
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});

test('a real content edit DOES re-parse (still COLD)', async () => {
    const tmpRoot = makeTmp('llmem-hash-edit-');
    try {
        write(tmpRoot, 'src/demo/a.ts', `export function alpha() { return 1; }\n`);
        const ctx = await createWorkspaceContext({ workspaceRoot: tmpRoot });

        const first = await buildDocumentFolderPrompt(ctx, { folderPath: asRelPath('src/demo') });
        assert.ok(first.structuralMarkdown.includes('alpha'), 'first run sees alpha');

        // Real byte change + bump mtime (cross fast-FS-clock granularity, same as
        // the existing edit test).
        const abs = path.join(tmpRoot, 'src/demo/a.ts');
        write(tmpRoot, 'src/demo/a.ts', `export function beta() { return 2; }\n`);
        const future = new Date(Date.now() + 5000);
        fs.utimesSync(abs, future, future);

        const second = await buildDocumentFolderPrompt(ctx, { folderPath: asRelPath('src/demo') });
        assert.ok(second.structuralMarkdown.includes('beta'), 're-run reflects the genuine edit');
        assert.ok(!second.structuralMarkdown.includes('alpha'), 'stale entity gone after re-parse');
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});

test('a legacy manifest WITHOUT the hash field is handled (recompute once, no crash, gains hash)', async () => {
    const tmpRoot = makeTmp('llmem-hash-legacy-');
    try {
        write(tmpRoot, 'src/demo/a.ts', `export function alpha() { return 1; }\n`);
        const ctx = await createWorkspaceContext({ workspaceRoot: tmpRoot });

        // Seed normally — first run writes a manifest WITH hashes.
        await buildDocumentFolderPrompt(ctx, { folderPath: asRelPath('src/demo') });

        const graphDir = path.join(tmpRoot, '.llmem', 'graph');
        const importEdgeFile = path.join(graphDir, 'import-edgelist.json');
        const manifestFile = path.join(graphDir, 'scan-manifest.json');

        // Simulate a pre-Loop-10 manifest: strip the hash field from every entry,
        // leave mtime/size intact.
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));
        for (const entry of Object.values<any>(manifest.files)) {
            delete entry.hash;
        }
        fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

        const mtime1 = fs.statSync(importEdgeFile).mtimeMs;

        // Bump the file's mtime (identical bytes) so the pre-filter fires and we
        // reach the hashless-legacy branch — a pure no-touch run would stay warm
        // on mtime+size and never exercise the legacy path.
        const abs = path.join(tmpRoot, 'src/demo/a.ts');
        const future = new Date(Date.now() + 5000);
        fs.utimesSync(abs, future, future);

        // Must NOT throw; treats the hashless-but-moved entry as `changed`
        // (recompute once).
        const second = await buildDocumentFolderPrompt(ctx, { folderPath: asRelPath('src/demo') });
        assert.ok(second.structuralMarkdown.includes('alpha'), 'recompute is correct (entity still present)');

        const mtime2 = fs.statSync(importEdgeFile).mtimeMs;
        assert.notEqual(mtime2, mtime1, 'hashless legacy entry recomputed once (edge list rewritten)');

        // The rewrite now persists a hash on that entry.
        const m2 = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));
        assert.match(m2.files['src/demo/a.ts'].hash, HEX64, 'recompute gains a content hash');
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});
