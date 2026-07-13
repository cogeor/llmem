/**
 * A5 (2026-07-13): `health` (and `review`/`find-cycles`, same `ensureGraph`
 * helper) auto-scan on first run instead of failing with "Please scan
 * workspace first." — and the edge-list probe honors the configured
 * artifactRoot (review bug 1.3: the old guards probed the DEFAULT root, so a
 * custom LLMEM_ARTIFACT_ROOT made them reject an already-scanned workspace).
 *
 * Spawn conventions follow cli-scan.test.ts (`spawn('node', [BIN, ...])`,
 * FORCE_COLOR=0, best-effort rmSync cleanup).
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
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

function runCli(
    tmp: string,
    args: string[],
    extraEnv: Record<string, string> = {},
): Promise<{ exitCode: number | null; output: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn('node', [BIN, ...args], {
            cwd: tmp,
            env: { ...process.env, FORCE_COLOR: '0', ...extraEnv },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let buf = '';
        const onData = (chunk: Buffer) => {
            buf += chunk.toString('utf8');
        };
        child.stdout!.on('data', onData);
        child.stderr!.on('data', onData);

        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`llmem ${args[0]} timed out; output so far:\n${buf}`));
        }, 60_000);

        child.once('exit', (code) => {
            clearTimeout(timer);
            resolve({ exitCode: code, output: buf });
        });
        child.once('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

function seedSources(tmp: string): void {
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
    fs.writeFileSync(
        path.join(tmp, 'src', 'b.ts'),
        "import { a } from './a';\nexport const b = a + 1;\n",
        'utf8',
    );
}

test('health with NO prior scan: auto-scans, exits 0, writes the report', async () => {
    ensureBuilt();

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-autoscan-'));
    seedSources(tmp);

    try {
        const { exitCode, output } = await runCli(tmp, ['health', '--workspace', tmp]);

        assert.equal(exitCode, 0, `expected exit 0, got ${exitCode}; output:\n${output}`);
        assert.match(
            output,
            /Indexing workspace\.\.\. \(first run\)/,
            `expected the first-run indexing banner:\n${output}`,
        );
        assert.match(output, /## Scorecard \(measurement vector\)/, 'scorecard printed');

        const mdPath = path.join(tmp, '.llmem', 'health-report.md');
        const jsonPath = path.join(tmp, '.llmem', 'health-report.json');
        assert.ok(fs.existsSync(mdPath), `expected ${mdPath} to exist`);
        assert.ok(fs.existsSync(jsonPath), `expected ${jsonPath} to exist`);
    } finally {
        try {
            fs.rmSync(tmp, { recursive: true, force: true });
        } catch {
            // Best-effort cleanup — Windows file watchers can delay release.
        }
    }
});

test('health honors LLMEM_ARTIFACT_ROOT: finds existing lists, does NOT rescan (bug 1.3)', async () => {
    ensureBuilt();

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-autoscan-'));
    seedSources(tmp);
    const env = { LLMEM_ARTIFACT_ROOT: 'custom/graph' };

    try {
        const scan = await runCli(tmp, ['scan', '--workspace', tmp], env);
        assert.equal(scan.exitCode, 0, `scan under custom root failed:\n${scan.output}`);
        assert.ok(
            fs.existsSync(path.join(tmp, 'custom', 'graph', 'import-edgelist.json')),
            'scan wrote edge lists under the custom artifact root',
        );

        const health = await runCli(tmp, ['health', '--workspace', tmp], env);
        assert.equal(health.exitCode, 0, `health under custom root failed:\n${health.output}`);
        assert.ok(
            !health.output.includes('Indexing workspace... (first run)'),
            `health must find the custom-root lists without rescanning; got:\n${health.output}`,
        );
        assert.match(health.output, /## Scorecard \(measurement vector\)/, 'scorecard printed');
    } finally {
        try {
            fs.rmSync(tmp, { recursive: true, force: true });
        } catch {
            // Best-effort cleanup — Windows file watchers can delay release.
        }
    }
});
