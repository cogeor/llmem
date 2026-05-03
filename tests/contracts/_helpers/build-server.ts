/**
 * Test harness for HTTP route contract tests.
 *
 * Extracted from `tests/contracts/http-route-dtos.test.ts` per the Loop 17
 * plan: when the contract test exceeded 300 lines we extracted the in-memory
 * server harness into this helper so the test file itself stays focused on
 * route-by-route assertions.
 *
 * The harness mirrors `tests/integration/server-hardening.test.ts` rather
 * than the full `GraphServer.start()` lifecycle. Each test gets a fresh
 * `http.Server` on an ephemeral port, the routes registered against
 * a minimal `ServerContext`, and a `request(opts)` helper that returns
 * `{ status, body }`. The temp workspace is created and cleaned up around
 * each `withServer(...)` call.
 */

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

import { HttpRequestHandler } from '../../../src/claude/server/http-handler';
import { registerRoutes } from '../../../src/claude/server/routes';
import type { ServerContext } from '../../../src/claude/server/routes';
import type { ServerConfig } from '../../../src/claude/server';
import { NoopLogger } from '../../../src/core/logger';

export interface RequestResult {
    status: number;
    body: string;
}

export interface RequestOptions {
    method?: string;
    path: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
}

export interface HarnessOverrides {
    config?: Partial<Required<ServerConfig>>;
    watchManager?: ServerContext['watchManager'];
    archWatcher?: ServerContext['archWatcher'];
    regenerateWebview?: ServerContext['regenerateWebview'];
}

export type RequestFn = (opts: RequestOptions) => Promise<RequestResult>;

export function buildConfig(overrides: Partial<Required<ServerConfig>> = {}): Required<ServerConfig> {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-http-route-dtos-'));
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

/**
 * Spin up a fresh in-memory HTTP server for the given test, register the
 * production routes against a minimal `ServerContext`, run `fn(request)`,
 * then close the server and remove the temp workspace.
 */
export async function withServer(
    overrides: HarnessOverrides,
    fn: (request: RequestFn) => Promise<void>,
): Promise<void> {
    const config = buildConfig(overrides.config);
    const httpHandler = new HttpRequestHandler({
        webviewDir: config.workspaceRoot + '/.artifacts/webview',
        verbose: false,
    });

    const ctx: ServerContext = {
        config,
        logger: NoopLogger,
        watchManager: overrides.watchManager ?? ({
            getWatchState: () => ({
                watchedFiles: [],
                totalFiles: 0,
                lastUpdated: new Date().toISOString(),
            }),
            refresh: async () => {},
            initialize: async () => {},
        } as any),
        archWatcher: overrides.archWatcher ?? ({
            readDoc: async () => null,
            writeDoc: async () => true,
        } as any),
        httpHandler,
        regenerateWebview: overrides.regenerateWebview ?? (async () => {}),
    };
    registerRoutes(ctx);

    const server = http.createServer((req, res) => httpHandler.handle(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (!addr || typeof addr !== 'object') throw new Error('server.address() failed');
    const port = addr.port;

    const request: RequestFn = (opts) =>
        new Promise<RequestResult>((resolve, reject) => {
            // Auto-set Content-Length when a body is present and the caller
            // didn't already supply one. Node's http.request leaves the
            // header off for non-POST methods (DELETE, PUT) which makes
            // some servers ignore the body.
            const headers: Record<string, string> = { ...(opts.headers ?? {}) };
            if (
                opts.body !== undefined &&
                !Object.keys(headers).some((k) => k.toLowerCase() === 'content-length')
            ) {
                const buf = typeof opts.body === 'string' ? Buffer.from(opts.body, 'utf-8') : opts.body;
                headers['Content-Length'] = String(buf.length);
            }
            const req = http.request(
                {
                    method: opts.method ?? 'GET',
                    host: '127.0.0.1',
                    port,
                    path: opts.path,
                    headers,
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
        fs.rmSync(config.workspaceRoot, { recursive: true, force: true });
    }
}
