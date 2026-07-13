/**
 * Integration test for `bin/llmem health` — Loop 09 `--fail-on` kind matrix and
 * `--json` measurement-vector shape + byte-determinism.
 *
 * Coverage split (documented to avoid brittle source-driven fixtures):
 *   - `import-cycle`, `call-cycle`, `recursion` are exercised end-to-end via
 *     real edge-list fixtures (a tmp workspace seeded with split edge lists).
 *   - `clone` / `hub` are exercised by a fast UNIT test of the pure predicate
 *     `reportHasFindingKind` (clones/hubs need real source + a scan-manifest to
 *     fabricate at the edge-list layer — not worth the flakiness here).
 *
 * Edge-list envelope is `schemaVersion: 4` (Loop 03 bump). The import CYCLE
 * fixture (`src/a.ts <-> src/b.ts`, kind `import`, NO `typeOnly` field) is a
 * REAL RUNTIME cycle -> `vector.importCyclesRuntime === 1`. The CALL-CYCLE
 * fixture seeds two entity nodes `f`/`g` with mutual `call` edges.
 *
 * Cross-platform: spawn `node` against the BIN shim (not `.cmd`),
 * `FORCE_COLOR=0`, `LOG_LEVEL=error`, normalize CRLF->LF before assertions.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { reportHasFindingKind } from '../../../src/application/analysis';
import type { HealthReport } from '../../../src/application/analysis';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'llmem');
const DIST_MAIN = path.join(REPO_ROOT, 'dist', 'cli', 'main.js');

function ensureBuilt(): void {
    if (!fs.existsSync(DIST_MAIN)) {
        throw new Error(
            `Expected ${DIST_MAIN} to exist. Run \`npm run build:entrypoints\` before \`npm run test:integration\`.`,
        );
    }
}

function normalizeStdout(s: string): string {
    return s.replace(/\r\n/g, '\n');
}

interface EdgeLit {
    source: string;
    target: string;
}

/** Mutual call cycle: entity ids with kind `call`. */
interface CallEdgeLit {
    source: string;
    target: string;
}

/**
 * Seed a tmp workspace with `package.json` + split edge lists under
 * `.llmem/graph`. Synthesizes file nodes for every import endpoint and entity
 * nodes for every call endpoint so `buildGraphsFromSplitEdgeLists` keeps the
 * edges. The call edge list is empty unless `callEdges` is given.
 */
function seedWorkspace(
    tmp: string,
    importEdges: EdgeLit[],
    callEdges: CallEdgeLit[] = [],
): void {
    fs.writeFileSync(path.join(tmp, 'package.json'), '{}', 'utf8');
    const graphDir = path.join(tmp, '.llmem', 'graph');
    fs.mkdirSync(graphDir, { recursive: true });

    const fileIds = new Set<string>();
    for (const e of importEdges) {
        fileIds.add(e.source);
        fileIds.add(e.target);
    }
    const fileNodes = [...fileIds].map((id) => ({
        id,
        name: id,
        kind: 'file' as const,
        fileId: id,
    }));

    const entityIds = new Set<string>();
    for (const e of callEdges) {
        entityIds.add(e.source);
        entityIds.add(e.target);
    }
    // `callGraph: 'semantic'` is REQUIRED: buildGraphsFromSplitEdgeLists drops
    // any entity node whose persisted `callGraph` capability is absent/'none'
    // (defaults to 'none' -> excluded), which would silently drop the call
    // edges and never form a cycle.
    const entityNodes = [...entityIds].map((id) => ({
        id,
        name: id.split('::').pop() ?? id,
        kind: 'function' as const,
        fileId: 'src/calls.ts',
        callGraph: 'semantic' as const,
    }));

    const importEnvelope = JSON.stringify({
        schemaVersion: 4,
        resolverVersion: 'ts-resolveModuleName-v1',
        timestamp: new Date().toISOString(),
        nodes: fileNodes,
        edges: importEdges.map((e) => ({
            source: e.source,
            target: e.target,
            kind: 'import' as const,
        })),
    });
    const callEnvelope = JSON.stringify({
        schemaVersion: 4,
        resolverVersion: 'ts-resolveModuleName-v1',
        timestamp: new Date().toISOString(),
        nodes: entityNodes,
        edges: callEdges.map((e) => ({
            source: e.source,
            target: e.target,
            kind: 'call' as const,
        })),
    });

    fs.writeFileSync(path.join(graphDir, 'import-edgelist.json'), importEnvelope, 'utf8');
    fs.writeFileSync(path.join(graphDir, 'call-edgelist.json'), callEnvelope, 'utf8');
}

function spawnHealth(tmp: string, extraArgs: string[] = []): {
    stdout: string;
    stderr: string;
    status: number | null;
} {
    const result = spawnSync('node', [BIN, 'health', '--workspace', tmp, ...extraArgs], {
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '0', LOG_LEVEL: 'error' },
    });
    return {
        stdout: normalizeStdout(result.stdout ?? ''),
        stderr: normalizeStdout(result.stderr ?? ''),
        status: result.status,
    };
}

function rmrf(dir: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch {
        // Best-effort cleanup — Windows file watchers can delay release.
    }
}

// A 2-file RUNTIME import cycle: a -> b and b -> a (no typeOnly edges).
const CYCLE_EDGES: EdgeLit[] = [
    { source: 'src/a.ts', target: 'src/b.ts' },
    { source: 'src/b.ts', target: 'src/a.ts' },
];

// A mutual call cycle: f -> g and g -> f.
const CALL_CYCLE_EDGES: CallEdgeLit[] = [
    { source: 'src/calls.ts::f', target: 'src/calls.ts::g' },
    { source: 'src/calls.ts::g', target: 'src/calls.ts::f' },
];

const ALL_VECTOR_KEYS = [
    'importCyclesRuntime',
    'importCyclesInclTypeOnly',
    'callCyclesMutual',
    'callCyclesRecursion',
    'cloneClustersHigh',
    'cloneClustersTotal',
    'maxFanIn',
    'hubOutliers',
    'hubUnstable',
    'filesOverBudget',
    'maxEffectiveWidth',
    'interfaceWidthShallowWide',
] as const;

test('--fail-on import-cycle: exit 1 on a RUNTIME cycle, 0 on a clean repo', () => {
    ensureBuilt();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-failon-'));
    try {
        seedWorkspace(tmp, CYCLE_EDGES);
        const failed = spawnHealth(tmp, ['--fail-on', 'import-cycle']);
        assert.equal(failed.status, 1, `runtime cycle should exit 1; stderr=${failed.stderr}`);

        seedWorkspace(tmp, []);
        const clean = spawnHealth(tmp, ['--fail-on', 'import-cycle']);
        assert.equal(clean.status, 0, `clean repo should exit 0; stderr=${clean.stderr}`);
    } finally {
        rmrf(tmp);
    }
});

test('--fail-on call-cycle: exit non-zero on a call-cycle fixture, 0 without', () => {
    ensureBuilt();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-failon-'));
    try {
        seedWorkspace(tmp, [], CALL_CYCLE_EDGES);
        const failed = spawnHealth(tmp, ['--fail-on', 'call-cycle']);
        assert.notEqual(failed.status, 0, `call cycle should exit non-zero; stderr=${failed.stderr}`);

        const ok = spawnHealth(tmp, []);
        assert.equal(ok.status, 0, `call cycle without --fail-on should exit 0; stderr=${ok.stderr}`);
    } finally {
        rmrf(tmp);
    }
});

test('reportHasFindingKind: clone/hub/recursion map to the right report source', () => {
    const base: HealthReport = {
        repo: 'fixture',
        vector: {
            importCyclesRuntime: 0,
            importCyclesInclTypeOnly: 0,
            callCyclesMutual: 0,
            callCyclesRecursion: 0,
            cloneClustersHigh: 0,
            cloneClustersTotal: 0,
            maxFanIn: 0,
            hubOutliers: 0,
            hubUnstable: 0,
            filesOverBudget: 0,
            maxEffectiveWidth: 0,
            interfaceWidthShallowWide: 0,
        },
        importCycles: [],
        callCycles: [],
        recursion: [],
        clones: [],
        hubs: [],
        interfaceWidth: [],
    };

    // Empty report: every kind is false.
    for (const kind of ['import-cycle', 'call-cycle', 'clone', 'hub', 'recursion', 'nonsense']) {
        assert.equal(reportHasFindingKind(base, kind), false, `${kind} false on empty report`);
    }

    // clone -> report.clones
    const withClone: HealthReport = {
        ...base,
        clones: [{
            id: 'c1', type: 'clone', severity: 'high', title: 't', detail: 'd',
            relatedFiles: [], cloneType: 'exact-body', similarity: 1, members: ['a', 'b'],
        }],
    };
    assert.equal(reportHasFindingKind(withClone, 'clone'), true, 'clone true when clones present');

    // hub -> report.hubs
    const withHub: HealthReport = {
        ...base,
        hubs: [{
            id: 'h1', type: 'hub', severity: 'medium', title: 't', detail: 'd',
            relatedFiles: [], ca: 9, ce: 0, instability: 0, label: 'unstable-hub',
        }],
    };
    assert.equal(reportHasFindingKind(withHub, 'hub'), true, 'hub true when hubs present');

    // recursion -> report.recursion (NOT report.callCycles) — the bug fix.
    const withRecursion: HealthReport = {
        ...base,
        recursion: [{
            id: 'r1', type: 'recursion', severity: 'low', title: 't', detail: 'd', relatedFiles: [],
        }],
    };
    assert.equal(reportHasFindingKind(withRecursion, 'recursion'), true, 'recursion reads report.recursion');

    // import-cycle keys on the RUNTIME vector dim, not the array.
    const withRuntimeCycle: HealthReport = {
        ...base,
        vector: { ...base.vector, importCyclesRuntime: 1 },
    };
    assert.equal(reportHasFindingKind(withRuntimeCycle, 'import-cycle'), true,
        'import-cycle keys on vector.importCyclesRuntime');
    // A type-only-only cycle (runtime 0, incl-type-only 1) does NOT trip the gate.
    const typeOnlyCycle: HealthReport = {
        ...base,
        vector: { ...base.vector, importCyclesRuntime: 0, importCyclesInclTypeOnly: 1 },
    };
    assert.equal(reportHasFindingKind(typeOnlyCycle, 'import-cycle'), false,
        'type-only cycle does NOT trip import-cycle gate');

    // interface-width keys on the shallow-wide SMELL count, NOT on the mere
    // existence of width findings (every real repo has those). Opt-in gate (D2).
    assert.equal(reportHasFindingKind(base, 'interface-width'), false,
        'interface-width false when no shallow-wide smell');
    const withShallowWide: HealthReport = {
        ...base,
        vector: { ...base.vector, interfaceWidthShallowWide: 1 },
    };
    assert.equal(reportHasFindingKind(withShallowWide, 'interface-width'), true,
        'interface-width keys on vector.interfaceWidthShallowWide');
});

test('--json: full HealthVector shape (all numeric dims) + byte-deterministic across two runs', () => {
    ensureBuilt();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-failon-'));
    try {
        seedWorkspace(tmp, []);
        const run1 = spawnHealth(tmp, ['--json']);
        assert.equal(run1.status, 0, `--json should exit 0; stderr=${run1.stderr}`);

        const parsed = JSON.parse(run1.stdout);
        assert.ok(parsed.vector, '--json emits a report with a vector');
        for (const key of ALL_VECTOR_KEYS) {
            assert.equal(
                typeof parsed.vector[key], 'number',
                `vector.${key} is a number (got ${JSON.stringify(parsed.vector[key])})`,
            );
        }
        assert.equal(
            Object.keys(parsed.vector).length, ALL_VECTOR_KEYS.length,
            'vector has exactly the declared dims',
        );

        // No ISO timestamp anywhere in the emitted JSON (the report is timestamp-free).
        assert.ok(
            !/\d{4}-\d{2}-\d{2}T/.test(run1.stdout),
            `--json stdout must contain no ISO timestamp; got:\n${run1.stdout}`,
        );

        // Byte-determinism: a SECOND run on the same unchanged fixture is identical.
        const run2 = spawnHealth(tmp, ['--json']);
        assert.equal(run2.status, 0, `--json (run2) should exit 0; stderr=${run2.stderr}`);
        const parsed2 = JSON.parse(run2.stdout);
        assert.equal(
            JSON.stringify(parsed.vector), JSON.stringify(parsed2.vector),
            'vector is byte-stable across two runs (no timestamp, stable key order)',
        );
        assert.equal(run1.stdout, run2.stdout, 'full --json stdout is byte-identical across runs');
    } finally {
        rmrf(tmp);
    }
});
