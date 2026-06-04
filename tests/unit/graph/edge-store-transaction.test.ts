/**
 * Unit tests for BaseEdgeListStore.withTransaction (Loop K2).
 *
 * The bare `save()` lock (Loop LS-10) serializes only the inner write. But
 * the in-process writers (toggle-watch, refresh-graph, server regenerator)
 * do `load(); mutate(); save()` with the LOAD outside the lock, so two of
 * them can both load the same old state, mutate independently, and the
 * later save clobbers the earlier — a lost update.
 *
 * `withTransaction(fn)` acquires the per-file write lock ONCE and runs
 * `load → fn → saveLocked` inside the held section, so concurrent
 * transactions on the same file serialize and BOTH mutations survive.
 *
 * Uses a real WorkspaceIO over a mkdtemp dir, mirroring edgelist-store.test.ts.
 */

import { strict as assert } from 'assert';
import { test, describe } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ImportEdgeListStore } from '../../../src/graph/edgelist';
import { WorkspaceIO } from '../../../src/workspace/workspace-io';
import { asWorkspaceRoot } from '../../../src/core/paths';

function mkTmp(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rm(p: string): void {
    fs.rmSync(p, { recursive: true, force: true });
}

async function setupIo(): Promise<{ parent: string; root: string; io: WorkspaceIO }> {
    const parent = mkTmp('llmem-k2-');
    const root = path.join(parent, 'workspace');
    fs.mkdirSync(root, { recursive: true });
    const io = await WorkspaceIO.create(asWorkspaceRoot(root));
    return { parent, root, io };
}

/** Resolve with a timeout guard so a deadlock surfaces as a failed test
 * (instead of hanging the whole suite until the runner kills it). */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        p,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`timeout (${ms}ms): ${label}`)), ms).unref(),
        ),
    ]);
}

describe('BaseEdgeListStore.withTransaction (Loop K2)', () => {
    test('two concurrent transactions on the SAME file both land (no lost update)', async () => {
        const { parent, root, io } = await setupIo();
        try {
            const artifactDir = path.join(io.getRealRoot(), '.artifacts');
            // Two store instances over the SAME import-edgelist.json file. Each
            // transaction loads the current state, adds a DISTINCT node, and
            // publishes. The per-file write lock serializes the two whole
            // load→mutate→save sequences, so the second sees the first's node.
            const s1 = new ImportEdgeListStore(artifactDir, io);
            const s2 = new ImportEdgeListStore(artifactDir, io);

            // Establish the file on disk first (empty), so both transactions
            // read a real on-disk state rather than the "missing file" branch.
            const seed = new ImportEdgeListStore(artifactDir, io);
            await seed.withTransaction(() => {
                /* no-op mutation: just create the empty envelope on disk */
                seed.clear();
            });

            // Force an interleave: each fn yields once before mutating, so
            // without the lock both would read the same (empty) state and the
            // second save would clobber the first. With the lock they serialize.
            await withTimeout(
                Promise.all([
                    s1.withTransaction(async () => {
                        await Promise.resolve();
                        s1.addNode({ id: 'src/1.ts::one', name: 'one', kind: 'function', fileId: 'src/1.ts' });
                    }),
                    s2.withTransaction(async () => {
                        await Promise.resolve();
                        s2.addNode({ id: 'src/2.ts::two', name: 'two', kind: 'function', fileId: 'src/2.ts' });
                    }),
                ]),
                5000,
                'two concurrent transactions',
            );

            const targetAbs = path.join(root, '.artifacts', 'import-edgelist.json');
            const parsed = JSON.parse(fs.readFileSync(targetAbs, 'utf-8'));
            const ids = parsed.nodes.map((n: { id: string }) => n.id).sort();
            assert.deepEqual(
                ids,
                ['src/1.ts::one', 'src/2.ts::two'],
                'both concurrent transactions must survive — neither clobbered',
            );
        } finally {
            rm(parent);
        }
    });

    test('control: two raw load();mutate();save() WOULD lose one update', async () => {
        const { parent, root, io } = await setupIo();
        try {
            const artifactDir = path.join(io.getRealRoot(), '.artifacts');
            const seed = new ImportEdgeListStore(artifactDir, io);
            await seed.withTransaction(() => seed.clear());

            const s1 = new ImportEdgeListStore(artifactDir, io);
            const s2 = new ImportEdgeListStore(artifactDir, io);

            // The unguarded composition the transaction replaces: load OUTSIDE
            // any lock, yield, mutate, save. Both load the seeded (empty) state,
            // so each save writes a single-node array and the later one wins.
            async function rawAppend(s: ImportEdgeListStore, node: { id: string; name: string; kind: 'function'; fileId: string }): Promise<void> {
                await s.load();
                await Promise.resolve();
                s.addNode(node);
                await s.save();
            }

            await Promise.all([
                rawAppend(s1, { id: 'src/1.ts::one', name: 'one', kind: 'function', fileId: 'src/1.ts' }),
                rawAppend(s2, { id: 'src/2.ts::two', name: 'two', kind: 'function', fileId: 'src/2.ts' }),
            ]);

            const targetAbs = path.join(root, '.artifacts', 'import-edgelist.json');
            const parsed = JSON.parse(fs.readFileSync(targetAbs, 'utf-8'));
            // Documents the hazard: exactly one node landed — one update lost.
            // (This is why withTransaction exists; the positive test above is
            // the load-bearing assertion.)
            assert.equal(
                parsed.nodes.length,
                1,
                'unguarded load();mutate();save() must lose one update (proves the transaction is needed)',
            );
        } finally {
            rm(parent);
        }
    });

    test('no deadlock: a transaction completes and a later save()/transaction on the same key still works', async () => {
        const { parent, root, io } = await setupIo();
        try {
            const artifactDir = path.join(io.getRealRoot(), '.artifacts');
            const store = new ImportEdgeListStore(artifactDir, io);

            // The transaction must release the per-file lock when it settles —
            // the non-reentrant queue would wedge forever if the inner save
            // re-acquired the key. The timeout guard turns a deadlock into a
            // failed assertion rather than a hung suite.
            await withTimeout(
                store.withTransaction(() => {
                    store.addNode({ id: 'src/a.ts::a', name: 'a', kind: 'function', fileId: 'src/a.ts' });
                }),
                5000,
                'first transaction',
            );

            // A subsequent public save() on the SAME file key must not block on
            // a lock the transaction failed to release.
            store.addNode({ id: 'src/b.ts::b', name: 'b', kind: 'function', fileId: 'src/b.ts' });
            await withTimeout(store.save(), 5000, 'follow-up save');

            // And a second transaction on the same key still acquires + releases.
            await withTimeout(
                store.withTransaction(() => {
                    store.addNode({ id: 'src/c.ts::c', name: 'c', kind: 'function', fileId: 'src/c.ts' });
                }),
                5000,
                'second transaction',
            );

            const targetAbs = path.join(root, '.artifacts', 'import-edgelist.json');
            const parsed = JSON.parse(fs.readFileSync(targetAbs, 'utf-8'));
            const ids = parsed.nodes.map((n: { id: string }) => n.id).sort();
            assert.deepEqual(ids, ['src/a.ts::a', 'src/b.ts::b', 'src/c.ts::c']);
        } finally {
            rm(parent);
        }
    });

    test('transaction returns fn result and publishes the mutation', async () => {
        const { parent, root, io } = await setupIo();
        try {
            const artifactDir = path.join(io.getRealRoot(), '.artifacts');
            const store = new ImportEdgeListStore(artifactDir, io);

            const returned = await store.withTransaction(() => {
                store.addNode({ id: 'src/x.ts::x', name: 'x', kind: 'function', fileId: 'src/x.ts' });
                return 42;
            });
            assert.equal(returned, 42, 'withTransaction must forward fn return value');

            const targetAbs = path.join(root, '.artifacts', 'import-edgelist.json');
            const parsed = JSON.parse(fs.readFileSync(targetAbs, 'utf-8'));
            assert.equal(parsed.nodes.length, 1);
            assert.equal(parsed.nodes[0].id, 'src/x.ts::x');
        } finally {
            rm(parent);
        }
    });
});
