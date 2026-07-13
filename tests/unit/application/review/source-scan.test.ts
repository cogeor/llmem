/**
 * D2 (2026-07-13) — unit coverage for the signals harness
 * (`signals/source-scan.ts`). Every scanner depends on it, and each
 * scanner is tested — but the harness itself (scoping, skip-on-unreadable,
 * merge/sort/dedupe) was not.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    loadScopedSources,
    runSignalScanners,
    sortDedupeCandidates,
    type ScopedSource,
    type SignalScanner,
} from '../../../../src/application/review/signals/source-scan';
import { createWorkspaceContext } from '../../../../src/application/workspace-context';
import type { ImportGraph } from '../../../../src/graph/types';

// Minimal ImportGraph with the given FILE node ids (plus one entity node
// that must be ignored by the file filter).
function graphWithFiles(fileIds: string[]): ImportGraph {
    const nodes = new Map<string, { id: string; kind: string }>();
    for (const id of fileIds) nodes.set(id, { id, kind: 'file' });
    nodes.set('src/a.ts::fn', { id: 'src/a.ts::fn', kind: 'function' });
    return { nodes, edges: [] } as unknown as ImportGraph;
}

describe('loadScopedSources', () => {
    test('loads in-scope files sorted by fileId; skips missing files and non-file nodes', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-srcscan-'));
        try {
            fs.mkdirSync(path.join(tmp, 'src', 'webview'), { recursive: true });
            fs.writeFileSync(path.join(tmp, 'src', 'webview', 'b.ts'), 'B', 'utf8');
            fs.writeFileSync(path.join(tmp, 'src', 'webview', 'a.ts'), 'A', 'utf8');
            fs.writeFileSync(path.join(tmp, 'src', 'other.ts'), 'OTHER', 'utf8');

            const ctx = await createWorkspaceContext({ workspaceRoot: tmp });
            const graph = graphWithFiles([
                'src/webview/b.ts',
                'src/webview/a.ts',
                'src/webview/vanished.ts', // in the graph, gone on disk → skipped
                'src/other.ts',            // out of scope
            ]);

            const sources = await loadScopedSources(ctx, graph, 'src/webview', 'folder');
            assert.deepEqual(
                sources.map(s => s.fileId),
                ['src/webview/a.ts', 'src/webview/b.ts'],
                'sorted, scoped, vanished skipped, entity node ignored',
            );
            assert.deepEqual(sources.map(s => s.text), ['A', 'B']);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    test('a path-escaping graph node is skipped, never thrown', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-srcscan-'));
        try {
            fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
            fs.writeFileSync(path.join(tmp, 'src', 'ok.ts'), 'OK', 'utf8');

            const ctx = await createWorkspaceContext({ workspaceRoot: tmp });
            const graph = graphWithFiles(['src/ok.ts', 'src/../../etc/passwd']);
            const sources = await loadScopedSources(ctx, graph, '', 'folder');
            assert.deepEqual(sources.map(s => s.fileId), ['src/ok.ts']);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});

describe('runSignalScanners', () => {
    const SOURCES: ScopedSource[] = [
        { fileId: 'src/a.ts', text: 'alpha' },
        { fileId: 'src/b.ts', text: 'beta' },
    ];

    test('merges results by item id across scanners, sorted + deduped', () => {
        const scannerOne: SignalScanner = () => [
            { itemId: 'D1', candidates: [{ ref: 'src/b.ts', note: 'x' }] },
        ];
        const scannerTwo: SignalScanner = () => [
            { itemId: 'D1', candidates: [
                { ref: 'src/a.ts', note: 'y' },
                { ref: 'src/b.ts', note: 'x' }, // duplicate across scanners
            ] },
            { itemId: 'ST1', candidates: [{ ref: 'src/a.ts' }] },
        ];

        const map = runSignalScanners(SOURCES, [scannerOne, scannerTwo]);
        assert.deepEqual(
            map.get('D1'),
            [{ ref: 'src/a.ts', note: 'y' }, { ref: 'src/b.ts', note: 'x' }],
            'merged, ref-sorted, dupe collapsed',
        );
        assert.equal(map.get('ST1')!.length, 1);
        assert.equal(map.size, 2);
    });

    test('scanners receive the sources verbatim; no scanners → empty map', () => {
        let received: ScopedSource[] | null = null;
        const spy: SignalScanner = (sources) => {
            received = sources;
            return [];
        };
        runSignalScanners(SOURCES, [spy]);
        assert.deepEqual(received, SOURCES);
        assert.equal(runSignalScanners(SOURCES, []).size, 0);
    });
});

describe('sortDedupeCandidates', () => {
    test('sorts by ref then note; dedupes on (ref, note)', () => {
        const out = sortDedupeCandidates([
            { ref: 'b', note: '2' },
            { ref: 'a', note: '9' },
            { ref: 'b', note: '1' },
            { ref: 'b', note: '2' }, // dupe
            { ref: 'a' },
        ]);
        assert.deepEqual(out, [
            { ref: 'a' },
            { ref: 'a', note: '9' },
            { ref: 'b', note: '1' },
            { ref: 'b', note: '2' },
        ]);
    });
});
