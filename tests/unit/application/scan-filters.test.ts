/**
 * LS-03 — filter gates (denylist / byte-size / line-count) + ScanCoverage.
 *
 * These pin the three enforcement gates wired into `scanFolder`'s walk:
 *   - Gate 3 denylist  → `coverage.skippedDenylist`
 *   - Gate 4 byte-size → `coverage.skippedSize`
 *   - Gate 5 line-count → `coverage.skippedLines`
 *
 * Each gate must (a) record the offending file in the CORRECT bucket and
 * (b) keep that file out of the graph (no nodes/edges for it). The line
 * gate boundary is ">" — exactly `maxFileLines` is KEPT, `+1` is SKIPPED.
 *
 * `maxFilesPerFolder` is display-only: a folder with more direct children
 * than the cap must still parse every supported file (no truncation).
 *
 * `scanFolderRecursive` must aggregate coverage across subfolders without
 * dropping entries.
 *
 * Uses real `scanFolder` / `scanFolderRecursive` against mkdtemp fixtures,
 * mirroring tests/unit/application/scan-containment.test.ts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    scanFolder,
    scanFolderRecursive,
} from '../../../src/application/scan';
import {
    createWorkspaceContext,
    type RuntimeConfig,
} from '../../../src/application/workspace-context';
import { CallEdgeListStore, ImportEdgeListStore } from '../../../src/graph/edgelist';

/** Create a temp workspace root (artifact dir is created by the scan). */
function makeRoot(): string {
    return fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-scanfilt-')),
    );
}

function write(root: string, rel: string, content: string): void {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
}

async function ctxFor(
    root: string,
    overrides: Partial<RuntimeConfig> = {},
) {
    const ctx = await createWorkspaceContext({
        workspaceRoot: root,
        configOverrides: { ...overrides },
    });
    // The edge-list stores do not auto-mkdir the artifact root; create it
    // so the scan's save() succeeds. ctx.artifactRoot is the default
    // (`.llmem/graph`) — no literal artifact path in this test.
    fs.mkdirSync(ctx.artifactRoot, { recursive: true });
    return ctx;
}

/** Load the on-disk graph nodes (file + entity) after a scan. */
async function loadNodeIds(root: string): Promise<Set<string>> {
    const ctx = await ctxFor(root);
    const artifactDir = ctx.artifactRoot;
    const callStore = new CallEdgeListStore(artifactDir, ctx.io);
    const importStore = new ImportEdgeListStore(artifactDir, ctx.io);
    await callStore.load();
    await importStore.load();
    const ids = new Set<string>();
    for (const n of [...callStore.getNodes(), ...importStore.getNodes()]) {
        ids.add(n.fileId);
    }
    return ids;
}

const SIMPLE_TS = 'export const x = 1;\nexport function f() { return x; }\n';

test('size gate: over-size file is recorded in skippedSize and not parsed', async () => {
    const root = makeRoot();
    try {
        // maxFileSizeKB = 1 → 1024-byte threshold.
        write(root, 'src/big.ts', 'export const blob = "' + 'a'.repeat(2000) + '";\n');
        write(root, 'src/small.ts', SIMPLE_TS);

        const ctx = await ctxFor(root, { maxFileSizeKB: 1 });
        const res = await scanFolder(ctx, { folderPath: 'src' });

        assert.deepEqual(res.coverage.skippedSize, ['src/big.ts']);
        assert.equal(res.coverage.skippedLines.length, 0);
        assert.equal(res.coverage.skippedDenylist.length, 0);

        const fileIds = await loadNodeIds(root);
        assert.ok(!fileIds.has('src/big.ts'), 'big.ts must not be in graph');
        assert.ok(fileIds.has('src/small.ts'), 'small.ts must be in graph');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('line gate: boundary is ">" — exactly maxFileLines kept, +1 skipped', async () => {
    const root = makeRoot();
    try {
        const maxFileLines = 5;
        // countFileLines == content.split('\n').length. A file whose content
        // ends WITHOUT a trailing newline and has N-1 '\n' chars => N lines.
        const exactly = Array.from({ length: maxFileLines }, (_, i) => `// line ${i}`).join('\n');
        const over = Array.from({ length: maxFileLines + 1 }, (_, i) => `// line ${i}`).join('\n');
        write(root, 'src/exact.ts', exactly);   // exactly maxFileLines lines → KEPT
        write(root, 'src/over.ts', over);        // maxFileLines+1 lines → SKIPPED

        const ctx = await ctxFor(root, { maxFileLines });
        const res = await scanFolder(ctx, { folderPath: 'src' });

        assert.deepEqual(res.coverage.skippedLines, ['src/over.ts']);

        const fileIds = await loadNodeIds(root);
        assert.ok(fileIds.has('src/exact.ts'), 'exactly-at-limit file must be kept');
        assert.ok(!fileIds.has('src/over.ts'), 'over-limit file must be skipped');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('denylist gate: *.min.js / *.d.ts recorded in skippedDenylist', async () => {
    const root = makeRoot();
    try {
        write(root, 'src/lib.min.js', 'var a=1;');
        write(root, 'src/types.d.ts', 'export declare const y: number;\n');
        write(root, 'src/real.ts', SIMPLE_TS);

        const ctx = await ctxFor(root);
        const res = await scanFolder(ctx, { folderPath: 'src' });

        assert.deepEqual(
            [...res.coverage.skippedDenylist].sort(),
            ['src/lib.min.js', 'src/types.d.ts'],
        );
        assert.equal(res.coverage.skippedSize.length, 0);
        assert.equal(res.coverage.skippedLines.length, 0);

        const fileIds = await loadNodeIds(root);
        assert.ok(!fileIds.has('src/lib.min.js'), 'min.js must be skipped');
        assert.ok(!fileIds.has('src/types.d.ts'), 'd.ts must be skipped');
        assert.ok(fileIds.has('src/real.ts'), 'real.ts must be in graph');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('maxFilesPerFolder is display-only: every supported file still parsed', async () => {
    const root = makeRoot();
    try {
        const cap = 3;
        const count = cap + 4; // more direct children than the cap
        const names: string[] = [];
        for (let i = 0; i < count; i++) {
            const rel = `src/f${i}.ts`;
            names.push(rel);
            write(root, rel, `export const v${i} = ${i};\n`);
        }

        const ctx = await ctxFor(root, { maxFilesPerFolder: cap });
        const res = await scanFolder(ctx, { folderPath: 'src' });

        // No file dropped by any gate.
        assert.equal(res.coverage.skippedSize.length, 0);
        assert.equal(res.coverage.skippedLines.length, 0);
        assert.equal(res.coverage.skippedDenylist.length, 0);
        assert.equal(res.filesProcessed, count, 'all files processed, no truncation');

        const fileIds = await loadNodeIds(root);
        for (const rel of names) {
            assert.ok(fileIds.has(rel), `${rel} must be in graph (no cap truncation)`);
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('PC-03: a folder with a .py file sets coverage.heuristicCallGraph (grammar-free)', async () => {
    const root = makeRoot();
    try {
        // The .py flag is set by EXTENSION before/independent of parsing, so it
        // fires even though parsing the .py would skip without tree-sitter-python.
        write(root, 'src/mod.py', 'def f():\n    return 1\n');
        write(root, 'src/util.ts', SIMPLE_TS);

        const ctx = await ctxFor(root);
        const res = await scanFolder(ctx, { folderPath: 'src' });

        assert.equal(res.coverage.heuristicCallGraph, true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('PC-03: a pure-.ts/.js folder leaves heuristicCallGraph false/absent', async () => {
    const root = makeRoot();
    try {
        write(root, 'src/a.ts', SIMPLE_TS);
        write(root, 'src/b.js', 'export const y = 2;\n');

        const ctx = await ctxFor(root);
        const res = await scanFolder(ctx, { folderPath: 'src' });

        assert.ok(!res.coverage.heuristicCallGraph, 'pure-semantic folder gets no heuristic flag');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('PC-03: scanFolderRecursive ORs heuristicCallGraph from a nested .py', async () => {
    const root = makeRoot();
    try {
        write(root, 'src/top.ts', SIMPLE_TS);
        write(root, 'src/sub/nested.py', 'def g():\n    return 2\n');

        const ctx = await ctxFor(root);
        const res = await scanFolderRecursive(ctx, { folderPath: 'src' });

        assert.equal(res.coverage.heuristicCallGraph, true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('scanFolderRecursive aggregates coverage across subfolders', async () => {
    const root = makeRoot();
    try {
        // top-level skip + nested skips of each kind.
        write(root, 'src/top.min.js', 'var a=1;');           // denylist (top)
        write(root, 'src/keep.ts', SIMPLE_TS);
        write(root, 'src/sub/big.ts', 'export const b = "' + 'a'.repeat(2000) + '";\n'); // size
        write(root, 'src/sub/nested.d.ts', 'export declare const z: number;\n');         // denylist
        write(root, 'src/sub/keep2.ts', SIMPLE_TS);

        const ctx = await ctxFor(root, { maxFileSizeKB: 1 });
        const res = await scanFolderRecursive(ctx, { folderPath: 'src' });

        assert.deepEqual(
            [...res.coverage.skippedDenylist].sort(),
            ['src/sub/nested.d.ts', 'src/top.min.js'],
        );
        assert.deepEqual(res.coverage.skippedSize, ['src/sub/big.ts']);

        const fileIds = await loadNodeIds(root);
        assert.ok(fileIds.has('src/keep.ts'));
        assert.ok(fileIds.has('src/sub/keep2.ts'));
        assert.ok(!fileIds.has('src/top.min.js'));
        assert.ok(!fileIds.has('src/sub/big.ts'));
        assert.ok(!fileIds.has('src/sub/nested.d.ts'));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
