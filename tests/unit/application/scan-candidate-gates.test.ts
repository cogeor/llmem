// tests/unit/application/scan-candidate-gates.test.ts
//
// Loop 08 (quality-refactor) — boundary coverage for the SHARED scan gate
// classifier (`classifyScanCandidate`) and the single-file refresh
// (`refreshFileGraph`) that now consumes it instead of re-implementing the
// gates inline.
//
// What these pin (against the SAME classifier `scanFolder`'s walk uses):
//   - line gate boundary ">": exactly `maxFileLines` is KEPT (parse);
//     `maxFileLines + 1` is SKIPPED (skipped-lines).
//   - size gate boundary ">": `maxFileSizeKB*1024` bytes is KEPT; +1 byte is
//     skipped-size.
//   - denylist: a *.min.js / *.d.ts file → skipped-denylist (never parsed).
//   - Python heuristic flag: a .py candidate reports `heuristic: true` even
//     without the grammar (extension-driven, parse-independent).
//
// And end-to-end through `refreshFileGraph` (the loop-08 refactor target):
//   - each gate routes to the correct ScanCoverage bucket + ManifestStatus,
//     and a gate-skipped file is NOT added to the stores.
//   - a parser-init failure (getParser throwing) → coverage.parseErrors +
//     manifest status 'error' (the runParser init-error path).
//
// Heuristic note: `refreshFileGraph` deliberately does NOT OR the heuristic
// flag into its single-file coverage (document-file renders only the §7
// COVERAGE NOTES for a refreshFileGraph result, never the heuristic caveat),
// so the Python heuristic assertion is made against the classifier directly —
// that is the unit that owns the flag and feeds the folder path.
//
// Fixtures mirror tests/unit/application/scan-filters.test.ts and
// tests/unit/application/scan-containment.test.ts (mkdtemp + createWorkspaceContext).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { classifyScanCandidate } from '../../../src/application/scan/candidate';
import { refreshFileGraph } from '../../../src/application/refresh-graph';
import {
    createWorkspaceContext,
    type RuntimeConfig,
} from '../../../src/application/workspace-context';
import { ParserRegistry } from '../../../src/parser/registry';
import {
    CallEdgeListStore,
    ImportEdgeListStore,
} from '../../../src/graph/edgelist';
import type { ManifestStatus } from '../../../src/application/scan-manifest';

function makeRoot(): string {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-gates-')));
}

function write(root: string, rel: string, content: string): void {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
}

async function ctxFor(root: string, overrides: Partial<RuntimeConfig> = {}) {
    const ctx = await createWorkspaceContext({
        workspaceRoot: root,
        configOverrides: { ...overrides },
    });
    // The edge-list stores + manifest writer do not auto-mkdir the artifact
    // root; create it so save()/writeManifest() succeed.
    fs.mkdirSync(ctx.artifactRoot, { recursive: true });
    return ctx;
}

/** Read the persisted manifest entry for `rel` after a refreshFileGraph call. */
function manifestEntry(root: string, rel: string): { status: ManifestStatus; lines: number } | undefined {
    const p = path.join(root, '.llmem', 'graph', 'scan-manifest.json');
    if (!fs.existsSync(p)) return undefined;
    const manifest = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return manifest.files[rel];
}

/** Set of fileIds across both on-disk stores after a scan/refresh. */
async function loadFileIds(root: string): Promise<Set<string>> {
    const ctx = await ctxFor(root);
    const callStore = new CallEdgeListStore(ctx.artifactRoot, ctx.io);
    const importStore = new ImportEdgeListStore(ctx.artifactRoot, ctx.io);
    await callStore.load();
    await importStore.load();
    const ids = new Set<string>();
    for (const n of [...callStore.getNodes(), ...importStore.getNodes()]) {
        ids.add(n.fileId);
    }
    return ids;
}

// ---------------------------------------------------------------------------
// classifyScanCandidate — exact gate boundaries (shared unit).
// ---------------------------------------------------------------------------

test('classifier line gate: exactly maxFileLines is parse, +1 is skipped-lines', async () => {
    const root = makeRoot();
    try {
        const maxFileLines = 5;
        // countFileLines == content.split('\n').length: N-1 newlines, no
        // trailing newline => N lines.
        const exact = Array.from({ length: maxFileLines }, (_, i) => `// l${i}`).join('\n');
        const over = Array.from({ length: maxFileLines + 1 }, (_, i) => `// l${i}`).join('\n');
        write(root, 'src/exact.ts', exact);
        write(root, 'src/over.ts', over);

        const ctx = await ctxFor(root, { maxFileLines });
        const registry = ParserRegistry.getInstance();

        const exactRes = classifyScanCandidate({
            rel: 'src/exact.ts',
            basename: 'exact.ts',
            sizeBytes: Buffer.byteLength(exact),
            absPath: path.join(root, 'src/exact.ts'),
            config: ctx.config,
            registry,
            workspaceRoot: ctx.workspaceRoot,
        });
        assert.equal(exactRes.decision, 'parse', 'exactly maxFileLines is kept');
        assert.equal(exactRes.lines, maxFileLines);

        const overRes = classifyScanCandidate({
            rel: 'src/over.ts',
            basename: 'over.ts',
            sizeBytes: Buffer.byteLength(over),
            absPath: path.join(root, 'src/over.ts'),
            config: ctx.config,
            registry,
            workspaceRoot: ctx.workspaceRoot,
        });
        assert.equal(overRes.decision, 'skipped-lines', 'maxFileLines+1 is skipped');
        assert.equal(overRes.lines, maxFileLines + 1);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('classifier size gate: maxFileSizeKB*1024 bytes is parse, +1 byte is skipped-size', async () => {
    const root = makeRoot();
    try {
        const maxFileSizeKB = 1; // 1024-byte threshold.
        const threshold = maxFileSizeKB * 1024;
        // A short single-line .ts file padded to an EXACT byte count via a
        // trailing comment, so the file still passes the line gate.
        const make = (bytes: number): string => {
            const prefix = '//';
            return prefix + 'a'.repeat(bytes - prefix.length);
        };
        const atLimit = make(threshold);
        const overLimit = make(threshold + 1);
        write(root, 'src/at.ts', atLimit);
        write(root, 'src/over.ts', overLimit);
        assert.equal(fs.statSync(path.join(root, 'src/at.ts')).size, threshold);
        assert.equal(fs.statSync(path.join(root, 'src/over.ts')).size, threshold + 1);

        const ctx = await ctxFor(root, { maxFileSizeKB });
        const registry = ParserRegistry.getInstance();

        const atRes = classifyScanCandidate({
            rel: 'src/at.ts',
            basename: 'at.ts',
            sizeBytes: threshold,
            absPath: path.join(root, 'src/at.ts'),
            config: ctx.config,
            registry,
            workspaceRoot: ctx.workspaceRoot,
        });
        assert.equal(atRes.decision, 'parse', '== threshold is KEPT (gate is ">")');

        const overRes = classifyScanCandidate({
            rel: 'src/over.ts',
            basename: 'over.ts',
            sizeBytes: threshold + 1,
            absPath: path.join(root, 'src/over.ts'),
            config: ctx.config,
            registry,
            workspaceRoot: ctx.workspaceRoot,
        });
        assert.equal(overRes.decision, 'skipped-size', '+1 byte is skipped-size');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('classifier denylist gate: *.min.js / *.d.ts => skipped-denylist (never parsed)', async () => {
    const root = makeRoot();
    try {
        write(root, 'src/lib.min.js', 'var a=1;');
        write(root, 'src/types.d.ts', 'export declare const y: number;\n');

        const ctx = await ctxFor(root);
        const registry = ParserRegistry.getInstance();

        for (const [rel, base] of [
            ['src/lib.min.js', 'lib.min.js'],
            ['src/types.d.ts', 'types.d.ts'],
        ] as const) {
            const res = classifyScanCandidate({
                rel,
                basename: base,
                sizeBytes: fs.statSync(path.join(root, rel)).size,
                absPath: path.join(root, rel),
                config: ctx.config,
                registry,
                workspaceRoot: ctx.workspaceRoot,
            });
            assert.equal(res.decision, 'skipped-denylist', `${rel} is denylisted`);
            assert.equal(res.lines, undefined, 'denylist skip never reads the file');
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('classifier heuristic flag: a .py candidate reports heuristic:true (grammar-free)', async () => {
    const root = makeRoot();
    try {
        write(root, 'src/mod.py', 'def f():\n    return 1\n');
        const ctx = await ctxFor(root);
        const registry = ParserRegistry.getInstance();

        const res = classifyScanCandidate({
            rel: 'src/mod.py',
            basename: 'mod.py',
            sizeBytes: fs.statSync(path.join(root, 'src/mod.py')).size,
            absPath: path.join(root, 'src/mod.py'),
            config: ctx.config,
            registry,
            workspaceRoot: ctx.workspaceRoot,
        });
        // Python's call graph is heuristic; the flag is set by EXTENSION,
        // independent of whether tree-sitter-python is installed.
        assert.equal(res.heuristic, true, '.py reports the heuristic-call-graph flag');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// refreshFileGraph — gates route to coverage + manifest status end-to-end.
// ---------------------------------------------------------------------------

test('refreshFileGraph: over-line file => skippedLines + manifest status skipped-lines, not in graph', async () => {
    const root = makeRoot();
    try {
        const maxFileLines = 5;
        const over = Array.from({ length: maxFileLines + 1 }, (_, i) => `export const v${i} = ${i};`).join('\n');
        write(root, 'src/big.ts', over);

        const ctx = await ctxFor(root, { maxFileLines });
        const coverage = await refreshFileGraph(ctx, { filePath: 'src/big.ts' });

        assert.deepEqual(coverage.skippedLines, ['src/big.ts']);
        assert.equal(coverage.skippedSize.length, 0);
        assert.equal(coverage.parseErrors.length, 0);

        const entry = manifestEntry(root, 'src/big.ts');
        assert.equal(entry?.status, 'skipped-lines');
        assert.equal(entry?.lines, maxFileLines + 1, 'counted line value threaded to manifest');

        const ids = await loadFileIds(root);
        assert.ok(!ids.has('src/big.ts'), 'over-line file is not in the graph');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('refreshFileGraph: over-size file => skippedSize + manifest status skipped-size', async () => {
    const root = makeRoot();
    try {
        write(root, 'src/blob.ts', 'export const b = "' + 'a'.repeat(2000) + '";\n');
        const ctx = await ctxFor(root, { maxFileSizeKB: 1 });
        const coverage = await refreshFileGraph(ctx, { filePath: 'src/blob.ts' });

        assert.deepEqual(coverage.skippedSize, ['src/blob.ts']);
        const entry = manifestEntry(root, 'src/blob.ts');
        assert.equal(entry?.status, 'skipped-size');
        // size-skip never reads the file → manifest lines stays 0.
        assert.equal(entry?.lines, 0);

        const ids = await loadFileIds(root);
        assert.ok(!ids.has('src/blob.ts'));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('refreshFileGraph: denylisted file => skippedDenylist + manifest status skipped-denylist', async () => {
    const root = makeRoot();
    try {
        write(root, 'src/vendor.min.js', 'var a=1;');
        const ctx = await ctxFor(root);
        const coverage = await refreshFileGraph(ctx, { filePath: 'src/vendor.min.js' });

        assert.deepEqual(coverage.skippedDenylist, ['src/vendor.min.js']);
        const entry = manifestEntry(root, 'src/vendor.min.js');
        assert.equal(entry?.status, 'skipped-denylist');

        const ids = await loadFileIds(root);
        assert.ok(!ids.has('src/vendor.min.js'));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('refreshFileGraph: clean file parses => parsed status, in graph, no coverage caveat', async () => {
    const root = makeRoot();
    try {
        write(root, 'src/ok.ts', 'export function ok() { return 1; }\n');
        const ctx = await ctxFor(root);
        const coverage = await refreshFileGraph(ctx, { filePath: 'src/ok.ts' });

        assert.equal(coverage.skippedSize.length, 0);
        assert.equal(coverage.skippedLines.length, 0);
        assert.equal(coverage.skippedDenylist.length, 0);
        assert.equal(coverage.parseErrors.length, 0);

        const entry = manifestEntry(root, 'src/ok.ts');
        assert.equal(entry?.status, 'parsed');

        const ids = await loadFileIds(root);
        assert.ok(ids.has('src/ok.ts'), 'clean file is in the graph');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('refreshFileGraph: parser-init failure => parseErrors + manifest status error (runParser init-error)', async (t) => {
    const root = makeRoot();
    const registry = ParserRegistry.getInstance();
    const originalGetParser = registry.getParser.bind(registry);
    // Stub getParser to throw for the target .ts file, simulating a
    // tree-sitter native-module construction failure. `.ts` is NOT in
    // SOURCE_LIKE_INSTALL_HINTS, so the classifier never calls getParser for
    // it — only the runParser parse path does, exercising the init-error arm.
    (registry as { getParser: typeof registry.getParser }).getParser = (
        filePath: string,
        workspaceRoot: string,
    ) => {
        if (filePath.replace(/\\/g, '/').endsWith('boom.ts')) {
            throw new Error('native grammar failed to load');
        }
        return originalGetParser(filePath, workspaceRoot);
    };
    t.after(() => {
        (registry as { getParser: typeof registry.getParser }).getParser = originalGetParser;
    });

    try {
        write(root, 'src/boom.ts', 'export function boom() { return 1; }\n');
        const ctx = await ctxFor(root);
        const coverage = await refreshFileGraph(ctx, { filePath: 'src/boom.ts' });

        assert.equal(coverage.parseErrors.length, 1, 'one parse error recorded');
        assert.equal(coverage.parseErrors[0].filePath, 'src/boom.ts');
        assert.match(coverage.parseErrors[0].message, /native grammar failed to load/);

        const entry = manifestEntry(root, 'src/boom.ts');
        assert.equal(entry?.status, 'error', 'manifest records error status');

        const ids = await loadFileIds(root);
        assert.ok(!ids.has('src/boom.ts'), 'failed file is not in the graph');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
