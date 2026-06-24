/**
 * Integration test for `bin/llmem health [--json] [--fail-on <kind>]`.
 *
 * Loop 02 (health-analysis) contract — end-to-end spawn test of the new
 * command against a tmp workspace seeded with split edge lists:
 *   1. Clean workspace: exit 0, both report files written under
 *      `<workspace>/.llmem/`, markdown printed (header + `No import cycles
 *      found.`), and the written `.json` has `vector.importCyclesRuntime === 0`.
 *   2. `--fail-on import-cycle` on a CLEAN workspace exits 0 (no cycle).
 *   3. `--fail-on import-cycle` on a 2-file CYCLE workspace exits non-zero (1);
 *      WITHOUT `--fail-on` the same workspace exits 0 and the md still reports
 *      `Found 1 import cycle(s):` (proving fail-on is opt-in).
 *   4. `--json` switches stdout to the JSON `HealthReport` but STILL writes both
 *      files (Micro-decision M1).
 *
 * Cross-platform notes mirror cli-describe.test.ts: spawn `node` against the BIN
 * shim (not `.cmd`), `FORCE_COLOR=0`, and normalize CRLF→LF before assertions.
 * The edge-list envelope is `schemaVersion: 3` (Loop 03 bumps to 4).
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

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

/**
 * Seed a tmp workspace with `package.json` + split edge lists under
 * `.llmem/graph`. `importEdges` build the import graph; file nodes are
 * synthesized for every endpoint so `buildGraphsFromSplitEdgeLists` keeps the
 * edges (a missing file-node drops the edge as dangling). The call edge list is
 * always empty.
 */
function seedWorkspace(tmp: string, importEdges: EdgeLit[]): void {
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

    const importEnvelope = JSON.stringify({
        schemaVersion: 3,
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
        schemaVersion: 3,
        resolverVersion: 'ts-resolveModuleName-v1',
        timestamp: new Date().toISOString(),
        nodes: [],
        edges: [],
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

// A 2-file import cycle: a -> b and b -> a.
const CYCLE_EDGES: EdgeLit[] = [
    { source: 'src/a.ts', target: 'src/b.ts' },
    { source: 'src/b.ts', target: 'src/a.ts' },
];

test('health on a clean workspace: exit 0, writes md+json, prints the report', () => {
    ensureBuilt();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-health-'));
    try {
        seedWorkspace(tmp, []);
        const { stdout, stderr, status } = spawnHealth(tmp);
        assert.equal(status, 0, `expected exit 0, got ${status}; stderr=${stderr}`);

        const mdPath = path.join(tmp, '.llmem', 'health-report.md');
        const jsonPath = path.join(tmp, '.llmem', 'health-report.json');
        assert.ok(fs.existsSync(mdPath), 'health-report.md written');
        assert.ok(fs.existsSync(jsonPath), 'health-report.json written');

        assert.ok(stdout.includes('# LLMem Health Report'), `report header printed; got:\n${stdout}`);
        assert.ok(stdout.includes('No import cycles found.'), `clean import-cycle section; got:\n${stdout}`);

        const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        assert.equal(parsed.vector.importCyclesRuntime, 0, 'no runtime import cycles');
    } finally {
        rmrf(tmp);
    }
});

test('health --fail-on import-cycle on a clean workspace exits 0', () => {
    ensureBuilt();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-health-'));
    try {
        seedWorkspace(tmp, []);
        const { status, stderr } = spawnHealth(tmp, ['--fail-on', 'import-cycle']);
        assert.equal(status, 0, `clean workspace + --fail-on should exit 0; stderr=${stderr}`);
    } finally {
        rmrf(tmp);
    }
});

test('health --fail-on import-cycle on a cycle workspace exits non-zero', () => {
    ensureBuilt();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-health-'));
    try {
        seedWorkspace(tmp, CYCLE_EDGES);
        const failed = spawnHealth(tmp, ['--fail-on', 'import-cycle']);
        assert.equal(failed.status, 1, `cycle + --fail-on should exit 1; stderr=${failed.stderr}`);

        // Opt-in proof: WITHOUT --fail-on the same workspace exits 0 and the
        // markdown still reports the cycle.
        const ok = spawnHealth(tmp, []);
        assert.equal(ok.status, 0, `cycle without --fail-on should exit 0; stderr=${ok.stderr}`);
        assert.ok(
            ok.stdout.includes('Found 1 import cycle(s):'),
            `cycle reported in md; got:\n${ok.stdout}`,
        );
    } finally {
        rmrf(tmp);
    }
});

test('health --json emits JSON to stdout and still writes both files', () => {
    ensureBuilt();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-health-'));
    try {
        seedWorkspace(tmp, []);
        const { stdout, stderr, status } = spawnHealth(tmp, ['--json']);
        assert.equal(status, 0, `--json should exit 0; stderr=${stderr}`);

        const parsed = JSON.parse(stdout);
        assert.ok(parsed.vector, '--json stdout parses to a HealthReport with a vector');

        assert.ok(
            fs.existsSync(path.join(tmp, '.llmem', 'health-report.md')),
            'md still written under --json (M1)',
        );
        assert.ok(
            fs.existsSync(path.join(tmp, '.llmem', 'health-report.json')),
            'json still written under --json (M1)',
        );
    } finally {
        rmrf(tmp);
    }
});
