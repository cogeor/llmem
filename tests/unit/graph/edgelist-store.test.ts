/**
 * Unit tests for EdgeListStore getNodesByFolder method.
 * Uses in-memory edge lists without file I/O.
 */

import { strict as assert } from 'assert';
import { test, describe } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Loop 16: types are imported from the schema module so the mock cannot
// drift from the persisted shape. Edges are typed as `any[]` here because
// this mock only exercises node-bucketing logic.
import type { NodeEntry, EdgeListData } from '../../../src/graph/edgelist-schema';
import { createEmptyEdgeList } from '../../../src/graph/edgelist-schema';
import {
    ImportEdgeListStore,
    CallEdgeListStore,
    writeFileAtomic,
    withWriteLock,
} from '../../../src/graph/edgelist';
import { WorkspaceIO } from '../../../src/workspace/workspace-io';
import { asWorkspaceRoot } from '../../../src/core/paths';

/**
 * In-memory mock of BaseEdgeListStore for testing.
 */
class MockEdgeListStore {
    private data: EdgeListData = createEmptyEdgeList();

    addNode(node: NodeEntry): void {
        const idx = this.data.nodes.findIndex(n => n.id === node.id);
        if (idx >= 0) {
            this.data.nodes[idx] = node;
        } else {
            this.data.nodes.push(node);
        }
    }

    addNodes(nodes: NodeEntry[]): void {
        for (const node of nodes) {
            this.addNode(node);
        }
    }

    getNodesByFile(fileId: string): NodeEntry[] {
        return this.data.nodes.filter(n => n.fileId === fileId);
    }

    getNodesByFolder(folderPath: string): NodeEntry[] {
        return this.data.nodes.filter(n =>
            n.fileId === folderPath ||
            n.fileId.startsWith(folderPath + '/')
        );
    }

    getNodes(): NodeEntry[] {
        return this.data.nodes;
    }
}

describe('EdgeListStore.getNodesByFolder', () => {
    test('should return nodes for exact file match', () => {
        const store = new MockEdgeListStore();
        store.addNodes([
            { id: 'src/utils.ts::helper', name: 'helper', kind: 'function', fileId: 'src/utils.ts' },
            { id: 'src/main.ts::main', name: 'main', kind: 'function', fileId: 'src/main.ts' }
        ]);

        const result = store.getNodesByFolder('src/utils.ts');
        assert.equal(result.length, 1);
        assert.equal(result[0].id, 'src/utils.ts::helper');
    });

    test('should return nodes for folder path', () => {
        const store = new MockEdgeListStore();
        store.addNodes([
            { id: 'src/parser/ts-service.ts::init', name: 'init', kind: 'function', fileId: 'src/parser/ts-service.ts' },
            { id: 'src/parser/ts-extractor.ts::extract', name: 'extract', kind: 'function', fileId: 'src/parser/ts-extractor.ts' },
            { id: 'src/main.ts::main', name: 'main', kind: 'function', fileId: 'src/main.ts' }
        ]);

        const result = store.getNodesByFolder('src/parser');
        assert.equal(result.length, 2);
        assert.ok(result.some(n => n.id === 'src/parser/ts-service.ts::init'));
        assert.ok(result.some(n => n.id === 'src/parser/ts-extractor.ts::extract'));
    });

    test('should return empty array for non-matching path', () => {
        const store = new MockEdgeListStore();
        store.addNodes([
            { id: 'src/utils.ts::helper', name: 'helper', kind: 'function', fileId: 'src/utils.ts' }
        ]);

        const result = store.getNodesByFolder('src/other');
        assert.equal(result.length, 0);
    });

    test('should not match partial folder names', () => {
        const store = new MockEdgeListStore();
        store.addNodes([
            { id: 'src/parsers/custom.ts::parse', name: 'parse', kind: 'function', fileId: 'src/parsers/custom.ts' },
            { id: 'src/parser/ts-service.ts::init', name: 'init', kind: 'function', fileId: 'src/parser/ts-service.ts' }
        ]);

        // 'src/parser' should NOT match 'src/parsers/custom.ts'
        const result = store.getNodesByFolder('src/parser');
        assert.equal(result.length, 1);
        assert.equal(result[0].fileId, 'src/parser/ts-service.ts');
    });

    test('should work with nested folders', () => {
        const store = new MockEdgeListStore();
        store.addNodes([
            { id: 'src/a/b/c/file.ts::fn', name: 'fn', kind: 'function', fileId: 'src/a/b/c/file.ts' },
            { id: 'src/a/b/file.ts::fn2', name: 'fn2', kind: 'function', fileId: 'src/a/b/file.ts' },
            { id: 'src/a/file.ts::fn3', name: 'fn3', kind: 'function', fileId: 'src/a/file.ts' }
        ]);

        // Query 'src/a/b' should return 2 nodes (b/file.ts and b/c/file.ts)
        const result = store.getNodesByFolder('src/a/b');
        assert.equal(result.length, 2);
    });

    test('existing getNodesByFile should still work', () => {
        const store = new MockEdgeListStore();
        store.addNodes([
            { id: 'src/utils.ts::helper1', name: 'helper1', kind: 'function', fileId: 'src/utils.ts' },
            { id: 'src/utils.ts::helper2', name: 'helper2', kind: 'function', fileId: 'src/utils.ts' },
            { id: 'src/main.ts::main', name: 'main', kind: 'function', fileId: 'src/main.ts' }
        ]);

        const result = store.getNodesByFile('src/utils.ts');
        assert.equal(result.length, 2);
        assert.ok(result.every(n => n.fileId === 'src/utils.ts'));
    });
});

// ---------------------------------------------------------------------------
// Loop LS-10 — atomic publish (temp-write + rename) + in-process write mutex.
// Uses a real WorkspaceIO over a mkdtemp dir, mirroring folder-edges-store.
// ---------------------------------------------------------------------------

function mkTmp(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rm(p: string): void {
    fs.rmSync(p, { recursive: true, force: true });
}

async function setupIo(): Promise<{ parent: string; root: string; io: WorkspaceIO }> {
    const parent = mkTmp('llmem-ls10-');
    const root = path.join(parent, 'workspace');
    fs.mkdirSync(root, { recursive: true });
    const io = await WorkspaceIO.create(asWorkspaceRoot(root));
    return { parent, root, io };
}

function listTmpArtifacts(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((n) => n.includes('.tmp-'));
}

describe('EdgeListStore atomic publish (Loop LS-10)', () => {
    test('mid-write failure (rename throws) leaves the PRIOR valid file intact, temp cleaned up', async () => {
        const { parent, root, io } = await setupIo();
        try {
            const artifactDir = path.join(io.getRealRoot(), '.artifacts');
            const store = new ImportEdgeListStore(artifactDir, io);
            // First save establishes a known-good file on disk.
            await store.load();
            store.addNode({
                id: 'src/a.ts::a',
                name: 'a',
                kind: 'function',
                fileId: 'src/a.ts',
            });
            await store.save();

            const targetAbs = path.join(root, '.artifacts', 'import-edgelist.json');
            const goodContent = fs.readFileSync(targetAbs, 'utf-8');
            const goodParsed = JSON.parse(goodContent);
            assert.equal(goodParsed.nodes.length, 1);

            // Now mutate and attempt a save that fails AFTER the temp write
            // but during the rename publish. We stub io.rename to throw once.
            const realRename = io.rename.bind(io);
            let renameCalls = 0;
            (io as unknown as { rename: typeof io.rename }).rename = async (
                from: string,
                to: string,
            ) => {
                renameCalls++;
                throw new Error('injected rename failure');
            };

            store.addNode({
                id: 'src/b.ts::b',
                name: 'b',
                kind: 'function',
                fileId: 'src/b.ts',
            });
            await assert.rejects(store.save(), /injected rename failure/);
            assert.equal(renameCalls, 1, 'rename should have been attempted once');

            // The on-disk target still contains the PRIOR valid JSON.
            const afterFail = fs.readFileSync(targetAbs, 'utf-8');
            assert.equal(afterFail, goodContent, 'prior file must be untouched');
            assert.doesNotThrow(() => JSON.parse(afterFail));
            assert.equal(JSON.parse(afterFail).nodes.length, 1);

            // The temp file was best-effort cleaned up — no .tmp-* leftovers.
            assert.deepEqual(
                listTmpArtifacts(path.join(root, '.artifacts')),
                [],
                'failed publish must not leave a .tmp-* file behind',
            );

            // Restore rename; a successful save now replaces the target.
            (io as unknown as { rename: typeof io.rename }).rename = realRename;
            await store.save();
            const afterSuccess = JSON.parse(fs.readFileSync(targetAbs, 'utf-8'));
            assert.equal(afterSuccess.nodes.length, 2);
            assert.deepEqual(
                listTmpArtifacts(path.join(root, '.artifacts')),
                [],
                'successful publish must not leave a .tmp-* file behind',
            );
        } finally {
            rm(parent);
        }
    });

    test('two concurrent store saves to the same file both land and never corrupt', async () => {
        const { parent, root, io } = await setupIo();
        try {
            // Two store instances over the SAME file. Each carries one
            // distinct node in memory and saves concurrently. The atomic
            // publish guarantees the file is always parseable; the mutex
            // serializes the two saves so neither produces a torn file.
            const artifactDir = path.join(io.getRealRoot(), '.artifacts');
            const s1 = new ImportEdgeListStore(artifactDir, io);
            const s2 = new ImportEdgeListStore(artifactDir, io);
            await s1.load();
            await s2.load();
            s1.addNode({ id: 'src/1.ts::one', name: 'one', kind: 'function', fileId: 'src/1.ts' });
            s2.addNode({ id: 'src/2.ts::two', name: 'two', kind: 'function', fileId: 'src/2.ts' });

            // Fire both WITHOUT awaiting in between.
            await Promise.all([s1.save(), s2.save()]);

            const targetAbs = path.join(root, '.artifacts', 'import-edgelist.json');
            const parsed = JSON.parse(fs.readFileSync(targetAbs, 'utf-8'));
            // Last-writer-wins on whole-state saves: exactly one valid state
            // landed (1 node), and the file is never truncated/corrupt.
            assert.equal(parsed.nodes.length, 1);
            assert.deepEqual(listTmpArtifacts(path.join(root, '.artifacts')), []);
        } finally {
            rm(parent);
        }
    });
});

// ---------------------------------------------------------------------------
// Loop LS-07 — removeByFile: precise per-file removal that purges edges by
// SOURCE *and* TARGET (removeByFolder only purged by source). Uses real
// stores over a mkdtemp WorkspaceIO so node/edge ID handling matches prod.
// ---------------------------------------------------------------------------

describe('EdgeListStore.removeByFile (Loop LS-07)', () => {
    test('import store: drops the file own node + OUTBOUND edge (source match)', async () => {
        const { parent, root, io } = await setupIo();
        try {
            const store = new ImportEdgeListStore(path.join(root, '.artifacts'), io);
            await store.load();
            store.addNode({ id: 'src/a.ts', name: 'a.ts', kind: 'file', fileId: 'src/a.ts' });
            store.addNode({ id: 'src/b.ts', name: 'b.ts', kind: 'file', fileId: 'src/b.ts' });
            store.addEdge({ source: 'src/a.ts', target: 'src/b.ts', kind: 'import' });

            store.removeByFile('src/a.ts');

            assert.deepEqual(store.getNodes().map(n => n.id), ['src/b.ts']);
            assert.equal(store.getEdges().length, 0, 'outbound edge from a.ts must be dropped');
        } finally {
            rm(parent);
        }
    });

    test('import store: drops INBOUND edge into a deleted file (TARGET match)', async () => {
        const { parent, root, io } = await setupIo();
        try {
            const store = new ImportEdgeListStore(path.join(root, '.artifacts'), io);
            await store.load();
            store.addNode({ id: 'src/a.ts', name: 'a.ts', kind: 'file', fileId: 'src/a.ts' });
            store.addNode({ id: 'src/b.ts', name: 'b.ts', kind: 'file', fileId: 'src/b.ts' });
            // a imports b — b is the TARGET. Deleting b must drop this inbound edge.
            store.addEdge({ source: 'src/a.ts', target: 'src/b.ts', kind: 'import' });

            store.removeByFile('src/b.ts');

            assert.deepEqual(store.getNodes().map(n => n.id), ['src/a.ts']);
            assert.equal(
                store.getEdges().length,
                0,
                'inbound edge into b.ts must be dropped (removeByFolder would have left it)',
            );
        } finally {
            rm(parent);
        }
    });

    test('import store: no collateral damage to sibling files', async () => {
        const { parent, root, io } = await setupIo();
        try {
            const store = new ImportEdgeListStore(path.join(root, '.artifacts'), io);
            await store.load();
            store.addNode({ id: 'src/a.ts', name: 'a.ts', kind: 'file', fileId: 'src/a.ts' });
            store.addNode({ id: 'src/ab.ts', name: 'ab.ts', kind: 'file', fileId: 'src/ab.ts' });
            store.addNode({ id: 'src/b.ts', name: 'b.ts', kind: 'file', fileId: 'src/b.ts' });
            store.addEdge({ source: 'src/ab.ts', target: 'src/b.ts', kind: 'import' });

            // Removing 'src/a.ts' must NOT touch the prefix-sibling 'src/ab.ts'
            // nor its edge.
            store.removeByFile('src/a.ts');

            assert.deepEqual(
                store.getNodes().map(n => n.id).sort(),
                ['src/ab.ts', 'src/b.ts'],
            );
            assert.equal(store.getEdges().length, 1, 'sibling edge must survive');
            assert.equal(store.getEdges()[0].source, 'src/ab.ts');
        } finally {
            rm(parent);
        }
    });

    test('call store: entity-id edges handled on both source and target', async () => {
        const { parent, root, io } = await setupIo();
        try {
            const store = new CallEdgeListStore(path.join(root, '.artifacts'), io);
            await store.load();
            store.addNode({ id: 'src/a.ts::fnA', name: 'fnA', kind: 'function', fileId: 'src/a.ts' });
            store.addNode({ id: 'src/b.ts::fnB', name: 'fnB', kind: 'function', fileId: 'src/b.ts' });
            store.addNode({ id: 'src/c.ts::fnC', name: 'fnC', kind: 'function', fileId: 'src/c.ts' });
            // a.fnA -> b.fnB (b is TARGET); b.fnB -> c.fnC (b is SOURCE).
            store.addEdge({ source: 'src/a.ts::fnA', target: 'src/b.ts::fnB', kind: 'call' });
            store.addEdge({ source: 'src/b.ts::fnB', target: 'src/c.ts::fnC', kind: 'call' });

            store.removeByFile('src/b.ts');

            // b.ts entity node gone; both edges referencing b (one as target,
            // one as source) gone; a and c untouched.
            assert.deepEqual(
                store.getNodes().map(n => n.id).sort(),
                ['src/a.ts::fnA', 'src/c.ts::fnC'],
            );
            assert.equal(store.getEdges().length, 0, 'both inbound and outbound entity edges dropped');
        } finally {
            rm(parent);
        }
    });

    test('removeByFolder still purges a whole folder prefix', async () => {
        const { parent, root, io } = await setupIo();
        try {
            const store = new ImportEdgeListStore(path.join(root, '.artifacts'), io);
            await store.load();
            store.addNode({ id: 'src/parser/a.ts', name: 'a.ts', kind: 'file', fileId: 'src/parser/a.ts' });
            store.addNode({ id: 'src/parser/b.ts', name: 'b.ts', kind: 'file', fileId: 'src/parser/b.ts' });
            store.addNode({ id: 'src/main.ts', name: 'main.ts', kind: 'file', fileId: 'src/main.ts' });
            store.addEdge({ source: 'src/parser/a.ts', target: 'src/parser/b.ts', kind: 'import' });

            store.removeByFolder('src/parser');

            assert.deepEqual(store.getNodes().map(n => n.id), ['src/main.ts']);
            assert.equal(store.getEdges().length, 0);
        } finally {
            rm(parent);
        }
    });
});

describe('In-process write mutex prevents lost updates (Loop LS-10)', () => {
    test('serialized load→merge→write composition keeps BOTH concurrent updates', async () => {
        const { parent, root, io } = await setupIo();
        try {
            fs.mkdirSync(path.join(root, '.artifacts'), { recursive: true });
            const rel = '.artifacts/counter.json';
            const lockKey = io.resolve(rel);
            await io.writeFile(rel, JSON.stringify({ items: [] as string[] }));

            // Each writer reads current state, appends its own item, then
            // atomically writes back — the classic read-modify-write that
            // loses updates under interleaving. Wrapping the WHOLE
            // composition under the same lock key serializes them.
            //
            // We force an interleave: read happens, then we yield (await a
            // resolved promise) before the write, so without the mutex both
            // reads would see [] and the second write would clobber the
            // first. With the mutex, writer B's composition cannot start
            // until writer A's has fully published.
            async function appendItem(item: string): Promise<void> {
                await withWriteLock(lockKey, async () => {
                    const current = JSON.parse(await io.readFile(rel)) as {
                        items: string[];
                    };
                    // Yield to let any non-serialized peer interleave here.
                    await Promise.resolve();
                    current.items.push(item);
                    await writeFileAtomic(io, rel, JSON.stringify(current));
                });
            }

            await Promise.all([appendItem('a'), appendItem('b')]);

            const final = JSON.parse(await io.readFile(rel)) as { items: string[] };
            assert.equal(final.items.length, 2, 'both updates must survive');
            assert.ok(final.items.includes('a'));
            assert.ok(final.items.includes('b'));
        } finally {
            rm(parent);
        }
    });

    test('control: WITHOUT the lock the same composition loses an update', async () => {
        const { parent, root, io } = await setupIo();
        try {
            fs.mkdirSync(path.join(root, '.artifacts'), { recursive: true });
            const rel = '.artifacts/counter2.json';
            await io.writeFile(rel, JSON.stringify({ items: [] as string[] }));

            // Same composition but UNlocked — demonstrates the hazard the
            // mutex protects against (this is the negative control proving
            // the positive test above is meaningful).
            async function appendItemUnlocked(item: string): Promise<void> {
                const current = JSON.parse(await io.readFile(rel)) as {
                    items: string[];
                };
                await Promise.resolve();
                current.items.push(item);
                await writeFileAtomic(io, rel, JSON.stringify(current));
            }

            await Promise.all([appendItemUnlocked('a'), appendItemUnlocked('b')]);

            const final = JSON.parse(await io.readFile(rel)) as { items: string[] };
            // Both read [] then each wrote a single-item array → one lost.
            assert.equal(
                final.items.length,
                1,
                'without the lock the interleave must lose an update (proves the lock is load-bearing)',
            );
        } finally {
            rm(parent);
        }
    });
});
