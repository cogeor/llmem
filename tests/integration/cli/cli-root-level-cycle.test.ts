/**
 * Regression test for bug 1.1 (2026-07-13 review): files at the WORKSPACE
 * ROOT were classified as external modules by `isExternalModuleId` (their
 * ids have no '/'), so internal-only scans dropped every import edge of a
 * flat repo. A fresh workspace with a genuine `a.ts` <-> `b.ts` cycle
 * scanned to 0 import edges and `find-cycles` reported none.
 *
 * This test is the original repro, end-to-end:
 *   1. mkdtemp → write `a.ts` and `b.ts` AT THE ROOT, importing each other.
 *   2. `llmem scan --workspace <tmp>` → exit 0.
 *   3. import-edgelist.json contains exactly the 2 file→file edges.
 *   4. `llmem find-cycles --workspace <tmp>` names both files in a cycle.
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
): Promise<{ exitCode: number | null; output: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn('node', [BIN, ...args], {
            cwd: tmp,
            env: { ...process.env, FORCE_COLOR: '0' },
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

test('root-level a.ts <-> b.ts cycle: scan emits both edges, find-cycles finds it', async () => {
    ensureBuilt();

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-rootcycle-'));
    // Deliberately at the workspace ROOT — no src/ folder. This is the
    // placement the old classifier broke on.
    fs.writeFileSync(
        path.join(tmp, 'a.ts'),
        "import { b } from './b';\nexport function a(): number { return b() + 1; }\n",
        'utf8',
    );
    fs.writeFileSync(
        path.join(tmp, 'b.ts'),
        "import { a } from './a';\nexport function b(): number { return a() - 1; }\n",
        'utf8',
    );

    try {
        const scan = await runCli(tmp, ['scan', '--workspace', tmp]);
        assert.equal(
            scan.exitCode,
            0,
            `expected scan exit 0, got ${scan.exitCode}; output:\n${scan.output}`,
        );

        const importEdgeListPath = path.join(tmp, '.llmem', 'graph', 'import-edgelist.json');
        assert.ok(fs.existsSync(importEdgeListPath), `expected ${importEdgeListPath} to exist`);

        const edgeList = JSON.parse(fs.readFileSync(importEdgeListPath, 'utf8'));
        const edges: Array<{ source: string; target: string }> = edgeList.edges;
        const pairs = edges.map((e) => `${e.source} -> ${e.target}`).sort();
        assert.deepEqual(
            pairs,
            ['a.ts -> b.ts', 'b.ts -> a.ts'],
            `expected exactly the two root-level cycle edges, got: ${JSON.stringify(pairs)}`,
        );

        const cycles = await runCli(tmp, ['find-cycles', '--workspace', tmp]);
        assert.equal(
            cycles.exitCode,
            0,
            `expected find-cycles exit 0, got ${cycles.exitCode}; output:\n${cycles.output}`,
        );
        assert.match(
            cycles.output,
            /Found 1 import cycle\(s\):/,
            `expected one cycle reported, got:\n${cycles.output}`,
        );
        assert.match(cycles.output, /a\.ts/, `cycle must name a.ts:\n${cycles.output}`);
        assert.match(cycles.output, /b\.ts/, `cycle must name b.ts:\n${cycles.output}`);
    } finally {
        try {
            fs.rmSync(tmp, { recursive: true, force: true });
        } catch {
            // Best-effort cleanup — Windows file watchers can delay release.
        }
    }
});
