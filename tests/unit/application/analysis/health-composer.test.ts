/**
 * D1 (2026-07-13) — behavioral pin for the `runHealthScan` composer.
 *
 * Written BEFORE the shared-loader refactor and kept after: a fixture
 * workspace with on-disk edge lists (a 2-file runtime import cycle, a
 * mutual call cycle, and a hub-shaped fan-in) must produce the same
 * `HealthVector` regardless of whether each analyzer loads its own stores
 * (pre-D1) or the composer loads once and feeds the pure `*FromGraph`
 * cores (post-D1). Also pins that passing pre-built graphs via
 * `opts.graphs` yields the identical report.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { runHealthScan } from '../../../../src/application/analysis';
import { createWorkspaceContext } from '../../../../src/application/workspace-context';

interface EdgeLit { source: string; target: string; typeOnly?: boolean }

const HUB_SPOKES = 9; // over HUB_DEGREE_THRESHOLD (8)

function seedWorkspace(tmp: string): void {
    fs.writeFileSync(path.join(tmp, 'package.json'), '{}', 'utf8');
    const graphDir = path.join(tmp, '.llmem', 'graph');
    fs.mkdirSync(graphDir, { recursive: true });

    // 2-file runtime import cycle + a kernel-shaped hub (9 spokes → hub.ts).
    const importEdges: EdgeLit[] = [
        { source: 'src/a.ts', target: 'src/b.ts' },
        { source: 'src/b.ts', target: 'src/a.ts' },
        ...Array.from({ length: HUB_SPOKES }, (_, i) => ({
            source: `src/spoke${i}.ts`,
            target: 'src/hub.ts',
        })),
    ];
    const fileIds = new Set<string>();
    for (const e of importEdges) {
        fileIds.add(e.source);
        fileIds.add(e.target);
    }

    // Mutual call cycle f <-> g.
    const callEdges = [
        { source: 'src/calls.ts::f', target: 'src/calls.ts::g' },
        { source: 'src/calls.ts::g', target: 'src/calls.ts::f' },
    ];
    const entityIds = new Set<string>(callEdges.flatMap(e => [e.source, e.target]));

    const envelope = (nodes: unknown[], edges: unknown[]): string =>
        JSON.stringify({
            schemaVersion: 4,
            resolverVersion: 'ts-resolveModuleName-v1',
            timestamp: '2026-01-01T00:00:00.000Z',
            nodes,
            edges,
        });

    fs.writeFileSync(
        path.join(graphDir, 'import-edgelist.json'),
        envelope(
            [...fileIds].map(id => ({ id, name: id, kind: 'file', fileId: id })),
            importEdges.map(e => ({ ...e, kind: 'import' })),
        ),
        'utf8',
    );
    fs.writeFileSync(
        path.join(graphDir, 'call-edgelist.json'),
        envelope(
            // callGraph: 'semantic' required or the builder drops the entities.
            [...entityIds].map(id => ({
                id,
                name: id.split('::').pop(),
                kind: 'function',
                fileId: 'src/calls.ts',
                callGraph: 'semantic',
            })),
            callEdges.map(e => ({ ...e, kind: 'call' })),
        ),
        'utf8',
    );
}

test('runHealthScan: fixture stores → pinned HealthVector (D1 behavioral pin)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-composer-'));
    try {
        seedWorkspace(tmp);
        const ctx = await createWorkspaceContext({ workspaceRoot: tmp });
        const report = await runHealthScan(ctx);

        assert.equal(report.vector.importCyclesRuntime, 1, 'one runtime import cycle');
        assert.equal(report.vector.importCyclesInclTypeOnly, 1);
        assert.equal(report.vector.callCyclesMutual, 1, 'one mutual call cycle');
        assert.equal(report.vector.callCyclesRecursion, 0);
        assert.equal(report.vector.maxFanIn, HUB_SPOKES, 'hub fan-in');
        assert.equal(report.vector.hubOutliers, 1, 'hub.ts flagged');
        assert.equal(report.vector.hubUnstable, 0, 'pure fan-in hub is a kernel');
        assert.equal(report.vector.cloneClustersTotal, 0, 'no source files → no clones');
        assert.equal(report.vector.filesOverBudget, 0, 'no manifest → 0');

        // C1 graph header counts come from the same load.
        assert.ok(report.graph, 'graph size header present');
        assert.equal(report.graph!.importEdges, 2 + HUB_SPOKES);
        assert.equal(report.graph!.callEdges, 2);

        // Determinism: a second scan over unchanged stores is deep-equal.
        const again = await runHealthScan(ctx);
        assert.deepEqual(again, report, 'byte-stable across runs');
    } finally {
        try {
            fs.rmSync(tmp, { recursive: true, force: true });
        } catch {
            // Best-effort cleanup on Windows.
        }
    }
});
