/**
 * Integration test for the auto-port-fallback in `GraphServer.start()`.
 *
 * Loop 02 contract: when the requested port is in use, the server walks
 * `startPort`, `startPort+1`, ..., up to 10 attempts on `EADDRINUSE`,
 * binds the first free port, and announces it via the existing
 * `printServerInfo()` path. No new flags, no change to `commands/serve.ts`.
 *
 * This test:
 *   1. Holds the default port (DEFAULT_PORT from config-defaults) with a sentinel `net.Server`.
 *   2. Spawns `bin/llmem serve --workspace <repo-root>`.
 *   3. Asserts stdout shows `Server running ... 127.0.0.1:<DEFAULT_PORT+1>`.
 *   4. Hits `/api/stats` on the bound port and asserts HTTP 200.
 *
 * Workspace: this test runs against a fresh `mkdtemp` workspace seeded
 * with two `.ts` files and relies on `serve`'s zero-config cold scan to
 * generate edge lists + webview under the centralized `.llmem/graph`
 * default. (Previously it coupled to `REPO_ROOT`'s legacy `.artifacts/`;
 * after storage centralization the repo no longer guarantees a populated
 * `.llmem/graph`, so a self-contained tmp workspace is correct.)
 * `LLMEM_ASSET_ROOT` points at the repo's `dist/webview` so the cold
 * regenerate finds the prebuilt webview HTML/JS (the tmp dir has no
 * `dist/`). `--no-open` keeps default-on browser-open from firing in CI.
 *
 * Cross-platform notes:
 * - `spawn('node', [BIN, ...])` rather than `spawn(BIN, ...)`. On Windows
 *   the npm `.cmd` wrapper would otherwise be invoked; calling `node`
 *   explicitly bypasses it and tests the actual JS shim end-to-end.
 *   Same convention as `cli-shim-smoke.test.ts`.
 * - The regex matches `127\.0\.0\.1:(\d+)` from the success log line, not
 *   any platform-specific socket error string. Node normalizes
 *   `EADDRINUSE` across Windows/macOS/Linux so no platform branches are
 *   needed.
 * - `FORCE_COLOR=0` keeps the structured logger from injecting ANSI
 *   codes that could confuse the regex.
 * - `serve` mixes structured logger output (stderr, MCP-compat default)
 *   with `console.log` workspace/regen lines (stdout). We listen on both
 *   streams because the "Server running ..." line comes from the
 *   structured logger and lands on stderr.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import * as net from 'node:net';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { DEFAULT_PORT } from '../../../src/config-defaults';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'llmem');
const DIST_MAIN = path.join(REPO_ROOT, 'dist', 'cli', 'main.js');
const DIST_WEBVIEW = path.join(REPO_ROOT, 'dist', 'webview');

function ensureBuilt(): void {
    if (!fs.existsSync(DIST_MAIN)) {
        throw new Error(
            `Expected ${DIST_MAIN} to exist. Run \`npm run build:entrypoints\` before \`npm run test:integration\`.`,
        );
    }
}

/** Bind a sentinel server to `port` so the next listener gets EADDRINUSE. */
function holdPort(port: number): Promise<net.Server> {
    return new Promise((resolve, reject) => {
        const blocker = net.createServer();
        blocker.once('error', reject);
        blocker.listen(port, '127.0.0.1', () => resolve(blocker));
    });
}

/**
 * Wait for a regex on the child's combined stdout+stderr, with a deadline.
 *
 * `serve` writes the "Server running ..." announcement via the structured
 * logger, whose default `output` is `console.error` (stderr) for
 * MCP-stdio compatibility. Workspace/regen lines come through `console.log`
 * (stdout). We watch both so this test is robust to which stream a future
 * refactor lands the success line on.
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

test('serve picks the next free port when the default is taken', async () => {
    ensureBuilt();

    // Self-contained fresh workspace: serve's zero-config cold scan
    // generates edge lists + webview under `.llmem/graph`. No dependency
    // on any pre-existing repo-root artifact directory.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-portfb-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
    fs.writeFileSync(
        path.join(tmp, 'src', 'b.ts'),
        "import { a } from './a';\nexport const b = a + 1;\n",
        'utf8',
    );

    const blocker = await holdPort(DEFAULT_PORT);
    const child = spawn('node', [BIN, 'serve', '--no-open', '--workspace', tmp], {
        cwd: tmp,
        env: { ...process.env, FORCE_COLOR: '0', LLMEM_ASSET_ROOT: DIST_WEBVIEW },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
        const out = await waitForOutput(
            child,
            /Server running.*127\.0\.0\.1:(\d+)/,
            30_000,
        );
        const m = out.match(/127\.0\.0\.1:(\d+)/);
        assert.ok(m, `expected a host:port in stdout, got:\n${out}`);
        const boundPort = Number(m![1]);
        const expectedFallback = DEFAULT_PORT + 1;
        assert.equal(boundPort, expectedFallback, `expected fallback to ${expectedFallback}, got ${boundPort}`);

        // Sanity-hit the API to confirm the server is actually listening.
        const status = await new Promise<number>((resolve, reject) => {
            http.get(`http://127.0.0.1:${boundPort}/api/stats`, (res) => {
                res.resume();
                resolve(res.statusCode ?? 0);
            }).on('error', reject);
        });
        assert.equal(status, 200, `/api/stats returned ${status}`);
    } finally {
        child.kill('SIGINT');
        await new Promise<void>((resolve) => {
            child.once('exit', () => resolve());
        });
        await new Promise<void>((resolve) => blocker.close(() => resolve()));
        try {
            fs.rmSync(tmp, { recursive: true, force: true });
        } catch {
            // Best-effort cleanup — Windows file watchers can delay release.
        }
    }
});
