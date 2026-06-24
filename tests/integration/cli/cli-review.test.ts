/**
 * Integration test for `bin/llmem review` (loop 02 — review-followups).
 *
 * Pins the positional-routing fix: `llmem review src/webview` must bind the
 * first positional to the review `--path` (today the dispatcher drops it into
 * the unused `flagMap._` bucket; `review.ts` now resolves
 * `args.path ?? args._[0] ?? ''`). The behavioral contract:
 *
 *   1. `review <path>` and `review --path <path>` produce BYTE-IDENTICAL output
 *      for both the markdown form and the `--json` ReviewChecklist form. The
 *      renderer is Date-free (review.ts:128-129), so stdout is byte-stable
 *      across runs and the equality holds deterministically.
 *   2. `--path` still wins when both a positional AND `--path` are supplied.
 *   3. Bare `review` (no positional, no `--path`) stays whole-repo: its
 *      checklist `path` is `''`, and that whole-repo output DIFFERS from the
 *      subtree run (so the default isn't accidentally bound to a positional).
 *
 * `review` guards on `hasEdgeLists` (review.ts:107), so the fixture MUST `scan`
 * first — same pre-scan device as cli-document.test.ts Test 2.
 *
 * Cross-platform notes (mirrors cli-document.test.ts exactly):
 * - `spawn('node', [BIN, ...])` not `spawn(BIN, ...)` — bypasses the Windows
 *   `.cmd` shim and exercises the JS entrypoint end-to-end.
 * - `FORCE_COLOR=0` + `LOG_LEVEL=error` keep stderr free of the parser-registry
 *   info banner.
 * - `fs.rmSync(..., { recursive: true, force: true })` cleanup is best-effort
 *   (Windows file watchers can delay release).
 *
 * Why spawn `bin/llmem` and not call `main()` in-process: positional routing
 * happens in the dispatcher (`parseArgv` → `flagMap._` → schema validation),
 * which only the real entrypoint exercises. The pure in-process unit test
 * (`tests/unit/cli/review.test.ts`) cannot reach it.
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

/**
 * Spawn `bin/llmem ...`, return separate stdout / stderr / exit code.
 *
 * - `args` is the full argv tail (including the subcommand name); we don't
 *   prefix anything so the helper works for `scan` (pre-scan setup) and
 *   `review` calls alike.
 * - 60s timeout matches the cli-document helper.
 */
function runCli(
    cwd: string,
    args: string[],
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

        child.stdin!.end();
    });
}

/**
 * Build a tmp workspace under os.tmpdir() with a couple of TS files under a
 * `src/webview/` subtree so a positional subtree review is non-empty.
 */
function mkFixture(): string {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-review-'));
    fs.mkdirSync(path.join(tmp, 'src', 'webview'), { recursive: true });
    fs.writeFileSync(
        path.join(tmp, 'src', 'webview', 'a.ts'),
        'export const a = 1;\n',
        'utf8',
    );
    fs.writeFileSync(
        path.join(tmp, 'src', 'webview', 'b.ts'),
        "import { a } from './a';\nexport const b = a + 1;\n",
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
// Test 1 — positional path and --path produce identical output (json + md)
// ----------------------------------------------------------------------------

test('review: positional path and --path produce byte-identical output (json + md)', async () => {
    ensureBuilt();
    const tmp = mkFixture();
    try {
        // review guards on hasEdgeLists — scan first.
        const scan = await runCli(tmp, ['scan', '--workspace', tmp]);
        assert.equal(
            scan.exitCode, 0,
            `pre-scan failed; stdout=${scan.stdout}\nstderr=${scan.stderr}`,
        );

        // --- JSON form ---
        const positionalJson = await runCli(tmp, [
            'review', 'src/webview', '--json', '--workspace', tmp,
        ]);
        const flagJson = await runCli(tmp, [
            'review', '--path', 'src/webview', '--json', '--workspace', tmp,
        ]);

        assert.equal(positionalJson.exitCode, 0, positionalJson.stderr);
        assert.equal(flagJson.exitCode, 0, flagJson.stderr);
        assert.equal(
            positionalJson.stdout,
            flagJson.stdout,
            'positional and --path must produce identical JSON stdout',
        );

        // --- Markdown form ---
        const positionalMd = await runCli(tmp, [
            'review', 'src/webview', '--workspace', tmp,
        ]);
        const flagMd = await runCli(tmp, [
            'review', '--path', 'src/webview', '--workspace', tmp,
        ]);

        assert.equal(positionalMd.exitCode, 0, positionalMd.stderr);
        assert.equal(flagMd.exitCode, 0, flagMd.stderr);
        assert.equal(
            positionalMd.stdout,
            flagMd.stdout,
            'positional and --path must produce identical markdown stdout',
        );
    } finally {
        rmTmp(tmp);
    }
});

// ----------------------------------------------------------------------------
// Test 2 — --path wins when both a positional and --path are supplied
// ----------------------------------------------------------------------------

test('review: --path wins over a conflicting positional', async () => {
    ensureBuilt();
    const tmp = mkFixture();
    try {
        const scan = await runCli(tmp, ['scan', '--workspace', tmp]);
        assert.equal(scan.exitCode, 0, scan.stderr);

        // --path src/webview alongside a positional `src` — --path must win,
        // so output equals the canonical `--path src/webview` run.
        const conflict = await runCli(tmp, [
            'review', 'src', '--path', 'src/webview', '--json', '--workspace', tmp,
        ]);
        const canonical = await runCli(tmp, [
            'review', '--path', 'src/webview', '--json', '--workspace', tmp,
        ]);

        assert.equal(conflict.exitCode, 0, conflict.stderr);
        assert.equal(canonical.exitCode, 0, canonical.stderr);
        assert.equal(
            conflict.stdout,
            canonical.stdout,
            '--path must win over the conflicting positional',
        );

        const checklist = JSON.parse(conflict.stdout);
        assert.equal(
            checklist.path, 'src/webview',
            `checklist.path should be the --path value; got ${checklist.path}`,
        );
    } finally {
        rmTmp(tmp);
    }
});

// ----------------------------------------------------------------------------
// Test 3 — bare review stays whole-repo (path === '') and differs from subtree
// ----------------------------------------------------------------------------

test('review: bare review stays whole-repo (path === "") and differs from a subtree run', async () => {
    ensureBuilt();
    const tmp = mkFixture();
    try {
        const scan = await runCli(tmp, ['scan', '--workspace', tmp]);
        assert.equal(scan.exitCode, 0, scan.stderr);

        const wholeRepo = await runCli(tmp, [
            'review', '--json', '--workspace', tmp,
        ]);
        assert.equal(wholeRepo.exitCode, 0, wholeRepo.stderr);

        const checklist = JSON.parse(wholeRepo.stdout);
        assert.equal(
            checklist.path, '',
            `bare review checklist.path should be '' (whole-repo); got ${checklist.path}`,
        );

        const subtree = await runCli(tmp, [
            'review', 'src/webview', '--json', '--workspace', tmp,
        ]);
        assert.equal(subtree.exitCode, 0, subtree.stderr);
        assert.notEqual(
            wholeRepo.stdout,
            subtree.stdout,
            'whole-repo output must differ from the subtree run (default not bound)',
        );
    } finally {
        rmTmp(tmp);
    }
});
