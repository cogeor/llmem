/**
 * Integration test for `bin/llmem document` (loop 06).
 *
 * Each test maps to one documented behavior of the `document` command:
 *   1. `--prompt-only` (file) → exits 0 with the file enrichment prompt on
 *      stdout (header `# DESIGN DOCUMENT GENERATION TASK`, the target path
 *      embedded). No banner contamination on stderr.
 *   2. `--prompt-only` (folder) → after a pre-scan, exits 0 with the folder
 *      enrichment prompt on stdout (header `# FOLDER DOCUMENTATION TASK`).
 *   3. `--content '<json>'` writes `.arch/{path}.md` and prints the
 *      forward-slash-normalized absolute path to stdout.
 *   4. `--content-file <path>` reads the JSON from disk; writes the same
 *      doc and does not consume the source payload file.
 *   5. `--content-file -` reads from stdin to EOF (synchronous
 *      `fs.readFileSync(0)` — exercises the historically buggy Windows
 *      stdin path).
 *   6. No flags → exits 1 with the helpful "post-v1" message on stderr.
 *   7. Positional vs `--path` parity — both produce identical output.
 *
 * Cross-platform notes:
 * - `spawn('node', [BIN, ...])` rather than `spawn(BIN, ...)`. On Windows
 *   the npm `.cmd` wrapper would otherwise be invoked; calling `node`
 *   explicitly bypasses it and tests the actual JS shim end-to-end. Same
 *   convention as `cli-shim-smoke.test.ts`, `cli-port-fallback.test.ts`,
 *   `cli-scan.test.ts`, and `cli-serve-zero-config.test.ts`.
 * - `FORCE_COLOR=0` and `LOG_LEVEL=error` in the spawn env keep stderr
 *   clean. The structured logger's default level is `info` and writes to
 *   stderr; we suppress it so the "no banner contamination" assertion is
 *   meaningful (parser-registry init still logs, otherwise).
 * - All assertions on stdout use `endsWith` / `includes` against
 *   forward-slash strings — never platform-aware path comparison. The
 *   command itself normalizes; the tests assert that.
 * - `fs.rmSync(..., { recursive: true, force: true })` in cleanup is
 *   best-effort (Windows file watchers can delay release).
 *
 * Why we spawn `bin/llmem` and not call `main()` in-process: `document`
 * ends with `process.exit(1)` on the helpful-message path, which would
 * kill the test runner. Spawning gives us a real exit-code observation.
 */

// TODO(loop 07+): Extract REPO_ROOT/BIN/DIST_MAIN/ensureBuilt to
// tests/integration/cli/_helpers.ts. cli-document.test.ts is the third file
// duplicating these constants (after cli-scan.test.ts and
// cli-port-fallback.test.ts); bumping the threshold once more before the
// cleanup is acceptable, but the next CLI-test loop must extract.

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
 * Spawn `bin/llmem ...`, return separate stdout / stderr / exit code.
 *
 * - `args` is the full argv tail (including the subcommand name); we don't
 *   prefix anything so the helper works for `scan` (pre-scan setup) and
 *   `document` calls alike.
 * - `stdin` (optional) is written to the child's stdin then `end()`'d.
 *   Used for the `--content-file -` test.
 * - 60s timeout matches the cli-scan helper.
 */
function runCli(
    cwd: string,
    args: string[],
    stdin?: string,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn('node', [BIN, ...args], {
            cwd,
            env: {
                ...process.env,
                FORCE_COLOR: '0',
                LOG_LEVEL: 'error',  // suppress parser-registry info banner
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdoutBuf = '';
        let stderrBuf = '';
        child.stdout!.on('data', (c: Buffer) => { stdoutBuf += c.toString('utf8'); });
        child.stderr!.on('data', (c: Buffer) => { stderrBuf += c.toString('utf8'); });

        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(
                `cli timed out; stdout=${stdoutBuf}\nstderr=${stderrBuf}`,
            ));
        }, 60_000);

        child.once('exit', (code) => {
            clearTimeout(timer);
            resolve({ exitCode: code, stdout: stdoutBuf, stderr: stderrBuf });
        });
        child.once('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });

        if (stdin !== undefined) {
            child.stdin!.write(stdin);
            child.stdin!.end();
        } else {
            child.stdin!.end();
        }
    });
}

/**
 * Build a tmp workspace under os.tmpdir() with two scaffolded TS files.
 * Each test calls this and pairs it with a try/finally cleanup.
 */
function mkFixture(): string {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-document-'));
    fs.mkdirSync(path.join(tmp, 'fixtures'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'fixtures', 'bar'), { recursive: true });
    fs.writeFileSync(
        path.join(tmp, 'fixtures', 'foo.ts'),
        'export const foo = 1;\n',
        'utf8',
    );
    fs.writeFileSync(
        path.join(tmp, 'fixtures', 'bar', 'baz.ts'),
        'export const baz = 2;\n',
        'utf8',
    );
    return tmp;
}

function rmTmp(tmp: string): void {
    try {
        fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
        // Best-effort cleanup — Windows file watchers can delay release.
    }
}

// ----------------------------------------------------------------------------
// Test 1 — --prompt-only (file)
// ----------------------------------------------------------------------------

test('document: --prompt-only on a file prints the file enrichment prompt to stdout', async () => {
    ensureBuilt();
    const tmp = mkFixture();
    try {
        const { exitCode, stdout, stderr } = await runCli(tmp, [
            'document',
            'fixtures/foo.ts',
            '--prompt-only',
            '--workspace', tmp,
        ]);

        assert.equal(exitCode, 0, `expected exit 0; stderr=${stderr}\nstdout=${stdout}`);
        assert.ok(
            stdout.includes('# DESIGN DOCUMENT GENERATION TASK'),
            `stdout missing header marker; got:\n${stdout}`,
        );
        assert.ok(
            stdout.includes('**Path:** `fixtures/foo.ts`'),
            `stdout missing target-path marker; got:\n${stdout}`,
        );
        assert.equal(
            stderr,
            '',
            `expected empty stderr (no banner contamination); got:\n${stderr}`,
        );
    } finally {
        rmTmp(tmp);
    }
});

// ----------------------------------------------------------------------------
// Test 2 — --prompt-only (folder)
// ----------------------------------------------------------------------------

test('document: --prompt-only on a folder prints the folder enrichment prompt', async () => {
    ensureBuilt();
    const tmp = mkFixture();
    try {
        // Pre-scan so .artifacts/ exists (folder prompt requires edge lists).
        const scan = await runCli(tmp, ['scan', '--workspace', tmp]);
        assert.equal(
            scan.exitCode, 0,
            `pre-scan failed; stdout=${scan.stdout}\nstderr=${scan.stderr}`,
        );

        const { exitCode, stdout } = await runCli(tmp, [
            'document',
            'fixtures/bar',
            '--prompt-only',
            '--workspace', tmp,
        ]);

        assert.equal(exitCode, 0, `expected exit 0; stdout=${stdout}`);
        assert.ok(
            stdout.includes('# FOLDER DOCUMENTATION TASK'),
            `stdout missing folder header; got:\n${stdout}`,
        );
        assert.ok(
            stdout.includes('`fixtures/bar`'),
            `stdout missing folder path; got:\n${stdout}`,
        );
    } finally {
        rmTmp(tmp);
    }
});

// ----------------------------------------------------------------------------
// Test 3 — --content writes the design doc
// ----------------------------------------------------------------------------

test('document: --content writes the design doc and prints the .arch path', async () => {
    ensureBuilt();
    const tmp = mkFixture();
    try {
        const payload = JSON.stringify({
            overview: 'A trivial fixture file.',
            inputs: 'none',
            outputs: 'foo',
            functions: [{
                name: 'foo',
                purpose: 'returns 1',
                implementation: '- returns 1',
            }],
        });

        const { exitCode, stdout } = await runCli(tmp, [
            'document',
            'fixtures/foo.ts',
            '--content', payload,
            '--workspace', tmp,
        ]);

        assert.equal(exitCode, 0, `expected exit 0; stdout=${stdout}`);
        assert.ok(
            stdout.trim().endsWith('/.arch/fixtures/foo.ts.md'),
            `stdout should end with forward-slash arch path; got:\n${stdout}`,
        );

        const expectedFile = path.join(tmp, '.arch', 'fixtures', 'foo.ts.md');
        assert.ok(
            fs.existsSync(expectedFile),
            `expected ${expectedFile} to exist`,
        );

        const written = fs.readFileSync(expectedFile, 'utf8');
        assert.ok(
            written.includes('A trivial fixture file.'),
            `written file missing overview body; got:\n${written}`,
        );
    } finally {
        rmTmp(tmp);
    }
});

// ----------------------------------------------------------------------------
// Test 4 — --content-file <path>
// ----------------------------------------------------------------------------

test('document: --content-file <path> reads JSON from disk', async () => {
    ensureBuilt();
    const tmp = mkFixture();
    try {
        const payload = JSON.stringify({
            overview: 'A trivial fixture file.',
            inputs: 'none',
            outputs: 'foo',
            functions: [{
                name: 'foo',
                purpose: 'returns 1',
                implementation: '- returns 1',
            }],
        });
        const payloadPath = path.join(tmp, 'payload.json');
        fs.writeFileSync(payloadPath, payload, 'utf8');

        const { exitCode, stdout } = await runCli(tmp, [
            'document',
            'fixtures/foo.ts',
            '--content-file', payloadPath,
            '--workspace', tmp,
        ]);

        assert.equal(exitCode, 0, `expected exit 0; stdout=${stdout}`);
        assert.ok(
            stdout.trim().endsWith('/.arch/fixtures/foo.ts.md'),
            `stdout should end with forward-slash arch path; got:\n${stdout}`,
        );

        const expectedFile = path.join(tmp, '.arch', 'fixtures', 'foo.ts.md');
        assert.ok(
            fs.existsSync(expectedFile),
            `expected ${expectedFile} to exist`,
        );

        const written = fs.readFileSync(expectedFile, 'utf8');
        assert.ok(
            written.includes('A trivial fixture file.'),
            `written file missing overview body; got:\n${written}`,
        );

        // The command reads the payload, does not move/delete it.
        assert.ok(
            fs.existsSync(payloadPath),
            'payload.json should still exist after --content-file read',
        );
    } finally {
        rmTmp(tmp);
    }
});

// ----------------------------------------------------------------------------
// Test 5 — --content-file - reads stdin to EOF
// ----------------------------------------------------------------------------

test('document: --content-file - reads JSON from stdin to EOF', async () => {
    ensureBuilt();
    const tmp = mkFixture();
    try {
        const payload = JSON.stringify({
            overview: 'A trivial fixture file.',
            inputs: 'none',
            outputs: 'foo',
            functions: [{
                name: 'foo',
                purpose: 'returns 1',
                implementation: '- returns 1',
            }],
        });

        const { exitCode, stdout } = await runCli(
            tmp,
            [
                'document',
                'fixtures/foo.ts',
                '--content-file', '-',
                '--workspace', tmp,
            ],
            payload,
        );

        assert.equal(exitCode, 0, `expected exit 0; stdout=${stdout}`);
        assert.ok(
            stdout.trim().endsWith('/.arch/fixtures/foo.ts.md'),
            `stdout should end with forward-slash arch path; got:\n${stdout}`,
        );

        const expectedFile = path.join(tmp, '.arch', 'fixtures', 'foo.ts.md');
        assert.ok(
            fs.existsSync(expectedFile),
            `expected ${expectedFile} to exist`,
        );

        const written = fs.readFileSync(expectedFile, 'utf8');
        assert.ok(
            written.includes('A trivial fixture file.'),
            `written file missing overview body; got:\n${written}`,
        );
    } finally {
        rmTmp(tmp);
    }
});

// ----------------------------------------------------------------------------
// Test 6 — no flags → non-zero + helpful message on stderr
// ----------------------------------------------------------------------------

test('document: no flags prints the helpful post-v1 message on stderr and exits 1', async () => {
    ensureBuilt();
    const tmp = mkFixture();
    try {
        const { exitCode, stdout, stderr } = await runCli(tmp, [
            'document',
            'fixtures/foo.ts',
            '--workspace', tmp,
        ]);

        assert.equal(exitCode, 1, `expected exit 1; stdout=${stdout}\nstderr=${stderr}`);
        assert.ok(
            stderr.includes(
                'Pass --prompt-only to get the prompt, then pipe the LLM output back via ' +
                '--content-file -. (Direct LLM invocation is post-v1.)',
            ),
            `stderr missing helpful message; got:\n${stderr}`,
        );
        assert.equal(
            stdout, '',
            `expected empty stdout (error goes to stderr only); got:\n${stdout}`,
        );
    } finally {
        rmTmp(tmp);
    }
});

// ----------------------------------------------------------------------------
// Test 7 — positional path routing parity with --path
// ----------------------------------------------------------------------------

test('document: positional path and --path produce identical output', async () => {
    ensureBuilt();
    const tmp = mkFixture();
    try {
        const positionalRun = await runCli(tmp, [
            'document',
            'fixtures/foo.ts',
            '--prompt-only',
            '--workspace', tmp,
        ]);
        const flagRun = await runCli(tmp, [
            'document',
            '--path', 'fixtures/foo.ts',
            '--prompt-only',
            '--workspace', tmp,
        ]);

        assert.equal(
            positionalRun.exitCode, 0,
            `positional run failed; stderr=${positionalRun.stderr}`,
        );
        assert.equal(
            flagRun.exitCode, 0,
            `--path run failed; stderr=${flagRun.stderr}`,
        );
        assert.equal(
            positionalRun.stdout,
            flagRun.stdout,
            'positional and --path forms must produce identical stdout',
        );
        assert.ok(
            positionalRun.stdout.includes('# DESIGN DOCUMENT GENERATION TASK'),
            `expected file prompt header in stdout; got:\n${positionalRun.stdout}`,
        );
    } finally {
        rmTmp(tmp);
    }
});
