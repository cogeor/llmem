// tests/integration/server-hardening.test.ts
//
// Loop 11 integration tests for the HTTP server hardening:
//
//   1. Body-size cap: a POST body larger than the configured `maxBytes`
//      returns 413, not 200/400.
//   2. Static-file path traversal: GET `/../../etc/passwd` returns 403,
//      not 200, even when an attacker-controlled file exists outside the
//      webview dir.
//   3. API token enforcement on mutating routes: when `apiToken` is set,
//      POST /api/regenerate without `Authorization: Bearer <token>` is
//      401; with the correct header it is 200. When `apiToken` is empty
//      (local dev mode), the same request is 200 with no header.
//
// To keep the test suite fast we don't drive the full `GraphServer.start`
// (which would regenerate the entire graph and spin up chokidar
// watchers). Instead we wire `HttpRequestHandler`, `registerRoutes`, and
// a hand-built `ServerContext` directly into a `http.createServer` and
// listen on an ephemeral port. The flow under test is the actual
// production code path: every request goes through the same
// `HttpRequestHandler.handle` that `GraphServer` uses.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    HttpRequestHandler,
    DEFAULT_MAX_BODY_BYTES,
} from '../../src/claude/server/http-handler';
import { registerRoutes } from '../../src/claude/server/routes';
import type { ServerContext } from '../../src/claude/server/routes';
import type { ServerConfig } from '../../src/claude/server';
import { NoopLogger } from '../../src/core/logger';

interface RequestResult {
    status: number;
    body: string;
}

interface RequestOptions {
    method?: string;
    path: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
}

/**
 * Minimal HTTP fixture: spins up `http.createServer` on port 0, wires
 * `HttpRequestHandler` + `registerRoutes(ctx)`, and gives the test a
 * single-shot request helper. Skips lifecycle setup (graph regeneration,
 * chokidar) so each test is < 200 ms.
 */
async function withServer(
    ctxOverrides: Partial<ServerContext> & { config: Required<ServerConfig> },
    fn: (req: (opts: RequestOptions) => Promise<RequestResult>) => Promise<void>,
): Promise<void> {
    const httpHandler = new HttpRequestHandler({
        webviewDir: ctxOverrides.config.workspaceRoot + '/.artifacts/webview',
        verbose: false,
    });

    const ctx: ServerContext = {
        config: ctxOverrides.config,
        logger: ctxOverrides.logger ?? NoopLogger,
        watchManager: ctxOverrides.watchManager ?? ({
            getWatchState: () => ({
                watchedFiles: [], totalFiles: 0, lastUpdated: new Date().toISOString(),
            }),
            refresh: async () => {},
            initialize: async () => {},
        } as any),
        archWatcher: ctxOverrides.archWatcher ?? ({
            readDoc: async () => null,
            writeDoc: async () => true,
        } as any),
        httpHandler,
        regenerateWebview: ctxOverrides.regenerateWebview ?? (async () => {}),
    };
    registerRoutes(ctx);

    const server = http.createServer((req, res) => httpHandler.handle(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (!addr || typeof addr !== 'object') throw new Error('server.address() failed');
    const port = addr.port;

    const request = (opts: RequestOptions): Promise<RequestResult> =>
        new Promise<RequestResult>((resolve, reject) => {
            const req = http.request(
                {
                    method: opts.method ?? 'GET',
                    host: '127.0.0.1',
                    port,
                    path: opts.path,
                    headers: opts.headers ?? {},
                },
                (res) => {
                    const chunks: Buffer[] = [];
                    res.on('data', (c: Buffer) => chunks.push(c));
                    res.on('end', () =>
                        resolve({
                            status: res.statusCode ?? 0,
                            body: Buffer.concat(chunks).toString('utf-8'),
                        }),
                    );
                },
            );
            req.on('error', reject);
            if (opts.body !== undefined) req.write(opts.body);
            req.end();
        });

    try {
        await fn(request);
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

function buildConfig(overrides: Partial<Required<ServerConfig>>): Required<ServerConfig> {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-server-hardening-'));
    return {
        port: 0,
        workspaceRoot: tmp,
        artifactRoot: '.artifacts',
        openBrowser: false,
        verbose: false,
        apiToken: '',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// 1. Body-size cap
// ---------------------------------------------------------------------------

test('body-size: POST /api/arch with body > 1 MB returns 413', async () => {
    const config = buildConfig({});
    try {
        await withServer({ config }, async (req) => {
            // Build a 2 MB JSON-shaped body. The exact contents don't matter —
            // the cap fires before JSON.parse.
            const huge = 'a'.repeat(DEFAULT_MAX_BODY_BYTES * 2);
            const body = JSON.stringify({ path: 'test', markdown: huge });
            const result = await req({
                method: 'POST',
                path: '/api/arch',
                headers: { 'Content-Type': 'application/json' },
                body,
            });
            assert.equal(
                result.status,
                413,
                `expected 413 Payload Too Large, got ${result.status}: ${result.body}`,
            );
            const parsed = JSON.parse(result.body);
            assert.equal(parsed.success, false);
            assert.match(parsed.message, /too large/i);
        });
    } finally {
        fs.rmSync(config.workspaceRoot, { recursive: true, force: true });
    }
});

test('body-size: POST /api/watch with oversized body returns 413', async () => {
    const config = buildConfig({});
    try {
        await withServer({ config }, async (req) => {
            const huge = 'b'.repeat(DEFAULT_MAX_BODY_BYTES + 1024);
            const body = JSON.stringify({ path: huge });
            const result = await req({
                method: 'POST',
                path: '/api/watch',
                headers: { 'Content-Type': 'application/json' },
                body,
            });
            assert.equal(
                result.status,
                413,
                `expected 413, got ${result.status}: ${result.body}`,
            );
        });
    } finally {
        fs.rmSync(config.workspaceRoot, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// 2. Static-file path traversal
// ---------------------------------------------------------------------------

test('path-traversal: GET /../../etc/passwd does not leak files outside webviewDir', async () => {
    const config = buildConfig({});
    try {
        // Create a real file outside the webview dir, in the workspace root.
        const outside = path.join(config.workspaceRoot, 'secret.txt');
        fs.writeFileSync(outside, 'top secret');

        await withServer({ config }, async (req) => {
            // The Node http server gives us `req.url = '/../secret.txt'`
            // verbatim. `path.normalize` collapses the leading `..` against
            // root, so the file resolves INSIDE webviewDir (where it doesn't
            // exist) — 404. The contract here: never 200, and the body must
            // not contain the secret content.
            const result = await req({
                method: 'GET',
                path: '/../secret.txt',
            });
            assert.notEqual(
                result.status, 200,
                `path traversal must not return 200; got ${result.status}: ${result.body.slice(0, 80)}`,
            );
            assert.ok(!result.body.includes('top secret'), 'response must not leak the outside-file contents');
            assert.ok(
                result.status === 403 || result.status === 404,
                `expected 403 or 404, got ${result.status}`,
            );
        });
    } finally {
        fs.rmSync(config.workspaceRoot, { recursive: true, force: true });
    }
});

test('path-traversal: drive-letter style URL returns 403 via path.relative containment', async () => {
    const config = buildConfig({});
    try {
        await withServer({ config }, async (req) => {
            // On Windows, `/C:/...` survives `path.normalize` and after
            // `path.join(webviewDir, ...)` would resolve outside the
            // webview dir — that's exactly what the post-join `path.relative`
            // check is for. On POSIX, the same shape is treated as a literal
            // child path and falls through to 404. Either way: never 200.
            const result = await req({
                method: 'GET',
                path: '/C:/Windows/system32/drivers/etc/hosts',
            });
            assert.notEqual(result.status, 200);
            if (process.platform === 'win32') {
                assert.equal(result.status, 403,
                    `Windows drive-letter URL must hit the new path.relative defense; got ${result.status}`);
            } else {
                // POSIX: the path doesn't escape after join, so 404 is expected.
                assert.ok(result.status === 403 || result.status === 404);
            }
        });
    } finally {
        fs.rmSync(config.workspaceRoot, { recursive: true, force: true });
    }
});

test('path-traversal: GET /..%2F..%2Fetc%2Fpasswd does not leak', async () => {
    const config = buildConfig({});
    try {
        await withServer({ config }, async (req) => {
            const result = await req({
                method: 'GET',
                path: '/..%2F..%2Fetc%2Fpasswd',
            });
            assert.notEqual(
                result.status, 200,
                `path traversal must not return 200; got ${result.status}: ${result.body.slice(0, 80)}`,
            );
            assert.ok(
                result.status === 403 || result.status === 404,
                `expected 403 or 404, got ${result.status}`,
            );
        });
    } finally {
        fs.rmSync(config.workspaceRoot, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// 3. API token enforcement
// ---------------------------------------------------------------------------

test('auth: POST /api/regenerate without token returns 401 when apiToken is set', async () => {
    const config = buildConfig({ apiToken: 'secret' });
    try {
        await withServer({ config }, async (req) => {
            const result = await req({
                method: 'POST',
                path: '/api/regenerate',
            });
            assert.equal(result.status, 401);
        });
    } finally {
        fs.rmSync(config.workspaceRoot, { recursive: true, force: true });
    }
});

test('auth: POST /api/regenerate with correct token returns 200 when apiToken is set', async () => {
    const config = buildConfig({ apiToken: 'secret' });
    try {
        await withServer({ config }, async (req) => {
            const result = await req({
                method: 'POST',
                path: '/api/regenerate',
                headers: { Authorization: 'Bearer secret' },
            });
            assert.equal(result.status, 200, `body=${result.body}`);
            const parsed = JSON.parse(result.body);
            assert.equal(parsed.success, true);
        });
    } finally {
        fs.rmSync(config.workspaceRoot, { recursive: true, force: true });
    }
});

test('auth: POST /api/regenerate with wrong token returns 401', async () => {
    const config = buildConfig({ apiToken: 'secret' });
    try {
        await withServer({ config }, async (req) => {
            const result = await req({
                method: 'POST',
                path: '/api/regenerate',
                headers: { Authorization: 'Bearer wrong-token' },
            });
            assert.equal(result.status, 401);
        });
    } finally {
        fs.rmSync(config.workspaceRoot, { recursive: true, force: true });
    }
});

test('auth: POST /api/regenerate without token returns 200 when apiToken is empty (local dev)', async () => {
    const config = buildConfig({ apiToken: '' });
    try {
        await withServer({ config }, async (req) => {
            const result = await req({
                method: 'POST',
                path: '/api/regenerate',
            });
            assert.equal(result.status, 200, `body=${result.body}`);
        });
    } finally {
        fs.rmSync(config.workspaceRoot, { recursive: true, force: true });
    }
});

test('auth: POST /api/arch without token returns 401 when apiToken is set', async () => {
    const config = buildConfig({ apiToken: 'secret' });
    try {
        await withServer({ config }, async (req) => {
            const result = await req({
                method: 'POST',
                path: '/api/arch',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: 'foo', markdown: 'bar' }),
            });
            assert.equal(result.status, 401);
        });
    } finally {
        fs.rmSync(config.workspaceRoot, { recursive: true, force: true });
    }
});

test('auth: GET /api/stats does not require token (read-only)', async () => {
    const config = buildConfig({ apiToken: 'secret' });
    try {
        // /api/stats reads from getGraphStats which expects edge-list files;
        // we don't seed them, so 500 is acceptable. The point: NOT 401.
        await withServer({ config }, async (req) => {
            const result = await req({ method: 'GET', path: '/api/stats' });
            assert.notEqual(
                result.status,
                401,
                'GET /api/stats must not require token (read-only route)',
            );
        });
    } finally {
        fs.rmSync(config.workspaceRoot, { recursive: true, force: true });
    }
});
