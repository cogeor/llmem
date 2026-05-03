/**
 * Integration test for `bin/llmem scan` (loop 05).
 *
 * Asserts the headline acceptance gate from design/06:
 *   1. Happy path — fresh workspace with two TS files (one importing the other)
 *      → exit 0, stdout shows the workspace banner and the
 *      "Indexed N files (M skipped, 0 errors)." summary, and the
 *      `.artifacts/import-edgelist.json` + `call-edgelist.json` files exist.
 *   2. Parse-error path — at least one file the ts-extractor cannot parse
 *      → exit 1 (process.exit(1) on errors), summary still printed with a
 *      non-zero error count, and the import-edgelist.json is STILL written
 *      (partial-success: edge lists for the good file get persisted, only
 *      the exit code signals failure).
 *
 * Cross-platform notes:
 * - `spawn('node', [BIN, ...])` rather than `spawn(BIN, ...)`. On Windows
 *   the npm `.cmd` wrapper would otherwise be invoked; calling `node`
 *   explicitly bypasses it and tests the actual JS shim end-to-end.
 *   Same convention as `cli-shim-smoke.test.ts`, `cli-port-fallback.test.ts`,
 *   and `cli-serve-zero-config.test.ts`.
 * - `FORCE_COLOR=0` in the spawn env keeps regex assertions clean.
 * - `fs.rmSync(..., { force: true })` in cleanup is best-effort: Windows
 *   file watchers can delay release, so we wrap it in try/catch and never
 *   assert on its outcome.
 * - All path assertions go through `path.join`, never string concat.
 *
 * Why we spawn the actual `bin/llmem` shim and not call `main()` in-process:
 * `scan` ends with `process.exit(1)` on errors, which would kill the test
 * runner. Spawning gives us a real exit-code observation and matches the
 * cli-serve-zero-config.test.ts approach.
 */

// TODO(loop 06+): extract REPO_ROOT/BIN/DIST_MAIN/ensureBuilt to a shared
// tests/integration/cli/_helpers.ts when cli-document.test.ts adds the third
// instance.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'llmem');
const DIST_MAIN = path.join(REPO_ROOT, 'dist', 'claude', 'cli', 'main.js');

function ensureBuilt(): void {
    if (!fs.existsSync(DIST_MAIN)) {
        throw new Error(
            `Expected ${DIST_MAIN} to exist. Run \`npm run build:claude\` before \`npm run test:integration\`.`,
        );
    }
}

/**
 * Spawn `bin/llmem scan ...`, collect combined stdout+stderr, resolve when
 * the child exits. `scan` is synchronous-ish (it writes the summary line
 * and exits), so we just wait for the `'exit'` event with a 60s deadline.
 */
function runScan(
    tmp: string,
    extraArgs: string[] = [],
): Promise<{ exitCode: number | null; output: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(
            'node',
            [BIN, 'scan', '--workspace', tmp, ...extraArgs],
            {
                cwd: tmp,
                env: { ...process.env, FORCE_COLOR: '0' },
                stdio: ['ignore', 'pipe', 'pipe'],
            },
        );

        let buf = '';
        const onData = (chunk: Buffer) => {
            buf += chunk.toString('utf8');
        };
        child.stdout!.on('data', onData);
        child.stderr!.on('data', onData);

        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`scan timed out; output so far:\n${buf}`));
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

test('scan: writes edge lists and exits 0 on a clean workspace', async () => {
    ensureBuilt();

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-scan-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
    fs.writeFileSync(
        path.join(tmp, 'src', 'b.ts'),
        "import { a } from './a';\nexport const b = a + 1;\n",
        'utf8',
    );

    try {
        const { exitCode, output } = await runScan(tmp);

        assert.equal(exitCode, 0, `expected exit 0 on clean workspace, got ${exitCode}; output:\n${output}`);
        assert.match(output, /Workspace: /, `expected "Workspace: " banner, got:\n${output}`);
        assert.match(
            output,
            /Indexed \d+ files \(\d+ skipped, 0 errors\)\./,
            `expected zero-error summary line, got:\n${output}`,
        );

        const importEdgeList = path.join(tmp, '.artifacts', 'import-edgelist.json');
        const callEdgeList = path.join(tmp, '.artifacts', 'call-edgelist.json');
        assert.ok(
            fs.existsSync(importEdgeList),
            `expected ${importEdgeList} to exist after scan`,
        );
        assert.ok(
            fs.existsSync(callEdgeList),
            `expected ${callEdgeList} to exist after scan`,
        );
    } finally {
        try {
            fs.rmSync(tmp, { recursive: true, force: true });
        } catch {
            // Best-effort cleanup — Windows file watchers can delay release.
        }
    }
});

test('scan: exits non-zero when a file fails to parse', async () => {
    ensureBuilt();

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-scan-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'good.ts'), 'export const x = 1;\n', 'utf8');
    // The TypeScript compiler is famously tolerant of malformed source —
    // unclosed braces, garbage bytes, even null bytes all produce a
    // recoverable AST and never throw out of `parser.extract`. The one
    // shape that DOES reliably throw is deeply nested syntax: it
    // overflows the recursive walk inside `ts.forEachChild` (a
    // `RangeError: Maximum call stack size exceeded`), which propagates
    // to scanFolder's per-file try/catch and lands in `result.errors`.
    // 3000 levels of `[ ... ]` is more than enough on Node 20 with
    // default stack size (~1 MB) and parses fast (~1.3s in local runs).
    const depth = 3000;
    fs.writeFileSync(
        path.join(tmp, 'src', 'broken.ts'),
        '['.repeat(depth) + '1' + ']'.repeat(depth) + ';\n',
        'utf8',
    );

    try {
        const { exitCode, output } = await runScan(tmp);

        assert.equal(exitCode, 1, `expected exit 1 on parse error, got ${exitCode}; output:\n${output}`);
        assert.match(
            output,
            /Indexed \d+ files \(\d+ skipped, [1-9]\d* errors\)\./,
            `expected non-zero error count in summary, got:\n${output}`,
        );

        // Partial-success: edge lists for the good file should still be
        // persisted — only the exit code signals failure.
        const importEdgeList = path.join(tmp, '.artifacts', 'import-edgelist.json');
        assert.ok(
            fs.existsSync(importEdgeList),
            `expected ${importEdgeList} to exist after partial-success scan`,
        );
    } finally {
        try {
            fs.rmSync(tmp, { recursive: true, force: true });
        } catch {
            // Best-effort cleanup — Windows file watchers can delay release.
        }
    }
});
