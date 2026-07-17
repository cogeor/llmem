// tests/unit/application/analysis/cache.test.ts
//
// Loop 06 — real `findClones` cache behavior over a tmp workspace. The parse
// path needs real files, so we mkdtemp a workspace, write source under src/,
// seed a call-edgelist with the file nodes (the in-scope set), build a
// WorkspaceContext, and call the analyzer IN-PROCESS (no spawn).
//
// Asserts:
//   1. Cold run populates the cache (contentHash + per-entity normalizedHash).
//   2. Unchanged file ⇒ hashes reused / normalizer NOT called on the warm run.
//   3. Changed file ⇒ recomputed (new contentHash + new entity hashes).
//   4. Deleted file (off disk AND out of the call-edgelist scope) ⇒ evicted.

import test from 'node:test';
import { mock } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { createWorkspaceContext } from '../../../../src/application/workspace-context';
import { findClones } from '../../../../src/application/analysis/clones';
import * as norm from '../../../../src/application/analysis/clones-normalize';

// A ≥20-token function body — two of these (modulo names/literals) cluster.
const BODY_A = [
    'export function alpha(input: number): number {',
    '    const scaled = input * 2;',
    '    const shifted = scaled + 1;',
    '    const total = shifted - 3;',
    '    return total > 0 ? total : 0;',
    '}',
].join('\n');

const BODY_B = [
    'export function beta(value: number): number {',
    '    const grown = value * 9;',
    '    const moved = grown + 7;',
    '    const sum = moved - 5;',
    '    return sum > 0 ? sum : 0;',
    '}',
].join('\n');

// A different shape for the "changed file" assertion.
const BODY_A2 = [
    'export function alpha(input: number): number {',
    '    return input;',
    '}',
].join('\n');

interface SeedFile {
    rel: string; // workspace-relative POSIX
    content: string;
}

function seedWorkspace(tmp: string, files: SeedFile[]): void {
    fs.writeFileSync(path.join(tmp, 'package.json'), '{}', 'utf8');
    for (const f of files) {
        const abs = path.join(tmp, f.rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, f.content, 'utf8');
    }
    const graphDir = path.join(tmp, '.llmem', 'graph');
    fs.mkdirSync(graphDir, { recursive: true });

    const fileNodes = files.map(f => ({
        id: f.rel,
        name: f.rel,
        kind: 'file' as const,
        fileId: f.rel,
    }));
    const envelope = (nodes: unknown[]) =>
        JSON.stringify({
            schemaVersion: 4,
            resolverVersion: 'ts-resolveModuleName-v1',
            timestamp: new Date().toISOString(),
            nodes,
            edges: [],
        });
    fs.writeFileSync(path.join(graphDir, 'call-edgelist.json'), envelope(fileNodes), 'utf8');
    fs.writeFileSync(path.join(graphDir, 'import-edgelist.json'), envelope([]), 'utf8');
}

function readCache(tmp: string): { version: number; files: Record<string, { contentHash: string; entities: { id: string; normalizedHash: string; tokenCount: number }[] }> } {
    const raw = fs.readFileSync(path.join(tmp, '.llmem', 'graph', 'analysis-cache.json'), 'utf8');
    return JSON.parse(raw);
}

function rmrf(dir: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch {
        // Best-effort — Windows file watchers can delay release.
    }
}

test('findClones cache: cold populate, warm reuse, change recompute, delete evict', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-clone-cache-'));
    try {
        seedWorkspace(tmp, [
            { rel: 'src/a.ts', content: BODY_A },
            { rel: 'src/b.ts', content: BODY_B },
        ]);
        const ctx = await createWorkspaceContext({ workspaceRoot: tmp });

        // --- 1. Cold run populates the cache. ---
        const cold = await findClones(ctx);
        assert.ok(cold.length >= 1, `cold run finds >=1 cluster; got ${cold.length}`);

        const cache1 = readCache(tmp);
        assert.ok(cache1.files['src/a.ts'], 'src/a.ts cached');
        assert.ok(cache1.files['src/a.ts'].contentHash.length > 0, 'contentHash set');
        assert.ok(
            cache1.files['src/a.ts'].entities.length >= 1 &&
                cache1.files['src/a.ts'].entities[0].normalizedHash.length > 0,
            'per-entity normalizedHash present',
        );

        // --- 2. Unchanged files ⇒ warm run does NOT call the normalizer. ---
        const spy = mock.method(norm, 'normalizeBody');
        try {
            const warm = await findClones(ctx);
            assert.equal(
                spy.mock.calls.length,
                0,
                `warm run must not re-normalize unchanged files; called ${spy.mock.calls.length}x`,
            );
            assert.deepEqual(
                warm.map(c => c.id),
                cold.map(c => c.id),
                'warm run yields the same clusters',
            );
        } finally {
            spy.mock.restore();
        }
        const cache2 = readCache(tmp);
        assert.deepEqual(
            cache2.files['src/a.ts'],
            cache1.files['src/a.ts'],
            'warm cache record byte-identical for unchanged file',
        );

        // --- 3. Changed file ⇒ recomputed. ---
        fs.writeFileSync(path.join(tmp, 'src/a.ts'), BODY_A2, 'utf8');
        await findClones(ctx);
        const cache3 = readCache(tmp);
        assert.notEqual(
            cache3.files['src/a.ts'].contentHash,
            cache1.files['src/a.ts'].contentHash,
            'changed file ⇒ new contentHash',
        );
        assert.notEqual(
            cache3.files['src/a.ts'].entities[0].normalizedHash,
            cache1.files['src/a.ts'].entities[0].normalizedHash,
            'changed file ⇒ new entity normalizedHash',
        );

        // --- 4. Deleted file (off disk + out of scope) ⇒ evicted. ---
        fs.rmSync(path.join(tmp, 'src/a.ts'));
        seedWorkspace(tmp, [{ rel: 'src/b.ts', content: BODY_B }]); // rewrites scope w/o a.ts
        await findClones(ctx);
        const cache4 = readCache(tmp);
        assert.equal(
            cache4.files['src/a.ts'],
            undefined,
            'deleted/out-of-scope file evicted from cache',
        );
        assert.ok(cache4.files['src/b.ts'], 'src/b.ts still cached');
    } finally {
        rmrf(tmp);
    }
});
