/**
 * Integration test for the zero-config `llmem serve` path (loop 03).
 *
 * Asserts the headline acceptance gate from design/06's "demo path":
 * a fresh workspace with no `.artifacts/` directory and no prior scan
 * still gets a working webview server when the user runs
 * `llmem serve --no-open --port 0`.
 *
 * Test body:
 *   1. mkdtemp → write `src/a.ts` and `src/b.ts` (`b` imports `a`).
 *   2. Spawn `node bin/llmem serve --port 0 --no-open --workspace <tmp>`.
 *   3. waitForOutput on `Server running.*127\.0\.0\.1:(\d+)`.
 *   4. http.get `/api/stats` → assert HTTP 200.
 *   5. Assert `<tmp>/.artifacts/import-edgelist.json` was written.
 *   6. Cleanup in finally.
 *
 * Cross-platform notes:
 * - `spawn('node', [BIN, ...])` rather than `spawn(BIN, ...)`. On Windows
 *   the npm `.cmd` wrapper would otherwise be invoked; calling `node`
 *   explicitly bypasses it and tests the actual JS shim end-to-end.
 *   Same convention as `cli-shim-smoke.test.ts` and `cli-port-fallback.test.ts`.
 * - The bound port comes from `--port 0` so two parallel test runs do not
 *   collide.
 * - `--no-open` is mandatory: without it, default-on `--open` fires
 *   `openBrowser` and CI sees a real `cmd /c start` / `xdg-open`
 *   invocation. Headless CI tolerates this (the child is detached and we
 *   ignore its exit), but it is noisy and can fail on locked-down runners.
 * - We set `LLMEM_ASSET_ROOT` to the repo's `dist/webview` so the cold
 *   regenerate step can find the prebuilt webview HTML/JS. The tmp
 *   workspace has no `dist/`, and walking up from a tmp `cwd` will not
 *   find the llmem repo root. The asset-root override is the
 *   documented escape hatch for exactly this case (see
 *   `src/claude/cli/commands/serve.ts:LLMEM_ASSET_ROOT`).
 * - Forward-slash normalization is not asserted in this test — that is
 *   the `cli-describe` snapshot test's job (loop 04). This test only
 *   asserts `boundPort` numeric, the `/api/stats` HTTP code, and that the
 *   import-edgelist.json file exists after the cold scan.
 * - `fs.rmSync(..., { force: true })` in the cleanup is best-effort: the
 *   running server holds a file watcher that may delay release on
 *   Windows; the rmSync is not a test assertion.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import * as http from 'node:http';
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
 * Wait for a regex on the child's combined stdout+stderr, with a deadline.
 *
 * `serve` writes the "Server running ..." announcement via the structured
 * logger, whose default `output` is `console.error` (stderr). Workspace
 * and indexing summary lines come through `console.log` (stdout). We
 * watch both streams.
 */
function waitForOutput(
    child: ReturnType<typeof spawn>,
    re: RegExp,
    ms: number,
): Promise<string> {
    return new Promise((resolve, reject) => {
        let buf = '';
        const timer = setTimeout(() => {
            reject(new Error(`Timed out waiting for ${re}; output so far:\n${buf}`));
        }, ms);
        const onData = (chunk: Buffer) => {
            buf += chunk.toString('utf8');
            if (re.test(buf)) {
                clearTimeout(timer);
                child.stdout!.removeListener('data', onData);
                child.stderr!.removeListener('data', onData);
                resolve(buf);
            }
        };
        child.stdout!.on('data', onData);
        child.stderr!.on('data', onData);
    });
}

/**
 * Shared test body — spawn `llmem serve` against a fresh tmp workspace
 * and assert it cold-scans, binds, and answers `/api/stats`.
 *
 * `extraEnv` lets the two test variants differ only in whether
 * `LLMEM_ASSET_ROOT` is set. The "without LLMEM_ASSET_ROOT" variant
 * exercises the `__dirname`-based install-root walk-up in
 * `resolveAssetRoot` — the resolver must still find `dist/webview`
 * starting from the compiled `web-launcher.js` location.
 */
async function runServeZeroConfig(extraEnv: Record<string, string>): Promise<void> {
    ensureBuilt();

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-zerocfg-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
    fs.writeFileSync(
        path.join(tmp, 'src', 'b.ts'),
        "import { a } from './a';\nexport const b = a + 1;\n",
        'utf8',
    );

    const child = spawn('node', [BIN, 'serve', '--port', '0', '--no-open', '--workspace', tmp], {
        cwd: tmp,
        env: {
            ...process.env,
            FORCE_COLOR: '0',
            ...extraEnv,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
        const out = await waitForOutput(
            child,
            /Server running.*127\.0\.0\.1:(\d+)/,
            60_000,
        );
        const m = out.match(/127\.0\.0\.1:(\d+)/);
        assert.ok(m, `expected a host:port in stdout, got:\n${out}`);
        const boundPort = Number(m![1]);
        assert.ok(
            Number.isFinite(boundPort) && boundPort > 0,
            `expected a positive bound port, got ${boundPort}`,
        );

        // Sanity-hit /api/stats.
        const status = await new Promise<number>((resolve, reject) => {
            http.get(`http://127.0.0.1:${boundPort}/api/stats`, (res) => {
                res.resume();
                resolve(res.statusCode ?? 0);
            }).on('error', reject);
        });
        assert.equal(status, 200, `/api/stats returned ${status}`);

        // Import edge list must have been written by the cold scan.
        const importEdgeList = path.join(tmp, '.artifacts', 'import-edgelist.json');
        assert.ok(
            fs.existsSync(importEdgeList),
            `expected ${importEdgeList} to exist after zero-config scan`,
        );

        // Indexing banner and summary land on stdout via console.log.
        assert.match(
            out,
            /Indexing workspace\.\.\. \(first run\)/,
            'expected first-run indexing banner in output',
        );
        assert.match(
            out,
            /Indexed \d+ files/,
            'expected an "Indexed N files" summary line in output',
        );
    } finally {
        child.kill('SIGINT');
        await new Promise<void>((resolve) => {
            child.once('exit', () => resolve());
        });
        try {
            fs.rmSync(tmp, { recursive: true, force: true });
        } catch {
            // Best-effort cleanup — Windows file watchers can delay release.
        }
    }
}

test('serve zero-config: cold scan + bind on a fresh workspace', async () => {
    const assetRoot = path.join(REPO_ROOT, 'dist', 'webview');
    await runServeZeroConfig({ LLMEM_ASSET_ROOT: assetRoot });
});

/**
 * Same body, no `LLMEM_ASSET_ROOT`. Exercises the followup fix to
 * `resolveAssetRoot`: when running from a fresh tmp cwd, the cwd-based
 * walk-up cannot find the llmem repo root, but the `__dirname`-based
 * install-root walk-up can — `dist/claude/web-launcher.js` is two levels
 * under the install root (the repo here), so the walk-up finds the
 * repo's `package.json` and resolves `<repo>/dist/webview`.
 *
 * If this test fails, the install-root walk-up is broken and
 * globally-installed `llmem` would fail without `LLMEM_ASSET_ROOT` set.
 */
test('serve in fresh tmp workspace finds bundled webview without LLMEM_ASSET_ROOT', async () => {
    await runServeZeroConfig({});
});
