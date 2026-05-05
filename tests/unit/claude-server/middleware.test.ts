/**
 * Loop 05 — unit tests for the four shared route-middleware helpers in
 * `src/claude/server/routes/middleware.ts`.
 *
 * These tests exercise the helpers in isolation, without spinning up a
 * real `http.Server` or going through `registerRoutes`. The integration
 * test `tests/integration/server-hardening.test.ts` continues to pin the
 * end-to-end contract; this file is added evidence (allow + deny paths
 * for each helper) that loop 06 can rely on when migrating routes onto
 * the helpers.
 *
 * Fixture pattern: hand-rolled fakes (no `node-mocks-http` dependency —
 * this repo does not use it). `fakeReq` builds a `PassThrough` stream
 * cast to `http.IncomingMessage` so `readRequestBody` works against it;
 * `fakeRes` records `setHeader` calls and is paired with a stub
 * `httpHandler.sendJson` that captures status + body. The result is a
 * single `withMockCtx(opts)` helper that builds everything routes need
 * without standing up the workspace.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import { PassThrough } from 'node:stream';

import {
    requireMethod,
    requireSameOrigin,
    requireApiToken,
    readJsonBody,
} from '../../../src/claude/server/routes/middleware';
import type { ServerContext } from '../../../src/claude/server/routes/types';
import type { HttpRequestHandler } from '../../../src/claude/server/http-handler';
import type { ServerConfig } from '../../../src/claude/server';
import { NoopLogger } from '../../../src/core/logger';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface CapturedResponse {
    status?: number;
    body?: any;
    headers: Record<string, string>;
}

function fakeReq(opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}): http.IncomingMessage {
    const r = new PassThrough() as unknown as http.IncomingMessage;
    (r as any).method = opts.method ?? 'POST';
    (r as any).headers = opts.headers ?? {};
    (r as any).url = '/api/test';
    if (opts.body !== undefined) {
        (r as unknown as PassThrough).end(opts.body);
    } else {
        (r as unknown as PassThrough).end();
    }
    return r;
}

function fakeRes(captured: CapturedResponse): http.ServerResponse {
    const res = {
        setHeader(k: string, v: string): void {
            captured.headers[k.toLowerCase()] = String(v);
        },
        // Stubs so HttpRequestHandler.sendJson would succeed if it were
        // ever called — but our `httpHandler.sendJson` stub bypasses both,
        // so these are unreachable. Provided defensively.
        writeHead(): void {},
        end(): void {},
    } as unknown as http.ServerResponse;
    return res;
}

interface MockCtx {
    ctx: ServerContext;
    captured: CapturedResponse;
}

function withMockCtx(opts?: { apiToken?: string }): MockCtx {
    const captured: CapturedResponse = { headers: {} };
    const httpHandler = {
        sendJson: (_res: http.ServerResponse, status: number, data: any): void => {
            captured.status = status;
            captured.body = data;
        },
    } as unknown as HttpRequestHandler;

    const config: Required<ServerConfig> = {
        port: 0,
        workspaceRoot: '/tmp/fake-workspace',
        artifactRoot: '.artifacts',
        assetRoot: '',
        openBrowser: false,
        verbose: false,
        apiToken: opts?.apiToken ?? '',
    };

    const ctx: ServerContext = {
        config,
        // Middleware reads only `config` and `httpHandler`; the rest is
        // a partial cast so we don't need to stand up a real workspace.
        ctx: {} as any,
        logger: NoopLogger,
        watchManager: {} as any,
        archWatcher: {} as any,
        httpHandler,
        regenerateWebview: async () => {},
    };
    return { ctx, captured };
}

// ---------------------------------------------------------------------------
// requireMethod
// ---------------------------------------------------------------------------

test('requireMethod: allows POST when methods=["POST"]', () => {
    const { ctx, captured } = withMockCtx();
    const req = fakeReq({ method: 'POST' });
    const res = fakeRes(captured);
    const ok = requireMethod(req, res, ctx, ['POST']);
    assert.equal(ok, true);
    assert.equal(captured.status, undefined, 'sendJson must not be called on allow');
    assert.equal(captured.headers['allow'], undefined, 'no Allow header on allow');
});

test('requireMethod: denies GET when methods=["POST"], 405 + Allow: POST', () => {
    const { ctx, captured } = withMockCtx();
    const req = fakeReq({ method: 'GET' });
    const res = fakeRes(captured);
    const ok = requireMethod(req, res, ctx, ['POST']);
    assert.equal(ok, false);
    assert.equal(captured.status, 405);
    assert.equal(captured.body.success, false);
    assert.match(captured.body.message, /not allowed/i);
    assert.equal(captured.headers['allow'], 'POST');
});

test('requireMethod: allows DELETE when methods=["POST", "DELETE"]', () => {
    const { ctx, captured } = withMockCtx();
    const req = fakeReq({ method: 'DELETE' });
    const res = fakeRes(captured);
    const ok = requireMethod(req, res, ctx, ['POST', 'DELETE']);
    assert.equal(ok, true);
    assert.equal(captured.status, undefined);
});

test('requireMethod: denies PUT when methods=["POST", "DELETE"], Allow: POST, DELETE', () => {
    const { ctx, captured } = withMockCtx();
    const req = fakeReq({ method: 'PUT' });
    const res = fakeRes(captured);
    const ok = requireMethod(req, res, ctx, ['POST', 'DELETE']);
    assert.equal(ok, false);
    assert.equal(captured.status, 405);
    assert.equal(captured.headers['allow'], 'POST, DELETE');
});

test('requireMethod: includes verb name in error message', () => {
    const { ctx, captured } = withMockCtx();
    const req = fakeReq({ method: 'PATCH' });
    const res = fakeRes(captured);
    requireMethod(req, res, ctx, ['POST']);
    assert.match(captured.body.message, /PATCH/);
});

// ---------------------------------------------------------------------------
// requireSameOrigin
// ---------------------------------------------------------------------------

test('requireSameOrigin: absent Origin header allows', () => {
    const { ctx, captured } = withMockCtx();
    const req = fakeReq({ headers: { host: '127.0.0.1:5757' } });
    const res = fakeRes(captured);
    const ok = requireSameOrigin(req, res, ctx);
    assert.equal(ok, true);
    assert.equal(captured.status, undefined);
});

test('requireSameOrigin: empty-string Origin allows (treated as absent)', () => {
    // `regenerate.ts:50` checks `length > 0`; an empty Origin should fall
    // through the allow path.
    const { ctx, captured } = withMockCtx();
    const req = fakeReq({
        headers: { host: '127.0.0.1:5757', origin: '' },
    });
    const res = fakeRes(captured);
    const ok = requireSameOrigin(req, res, ctx);
    assert.equal(ok, true);
    assert.equal(captured.status, undefined);
});

test('requireSameOrigin: same origin (http://127.0.0.1:5757 vs Host 127.0.0.1:5757) allows', () => {
    const { ctx, captured } = withMockCtx();
    const req = fakeReq({
        headers: {
            host: '127.0.0.1:5757',
            origin: 'http://127.0.0.1:5757',
        },
    });
    const res = fakeRes(captured);
    const ok = requireSameOrigin(req, res, ctx);
    assert.equal(ok, true);
    assert.equal(captured.status, undefined);
});

test('requireSameOrigin: localhost canonicalisation (Origin localhost vs Host 127.0.0.1) allows', () => {
    const { ctx, captured } = withMockCtx();
    const req = fakeReq({
        headers: {
            host: '127.0.0.1:5757',
            origin: 'http://localhost:5757',
        },
    });
    const res = fakeRes(captured);
    const ok = requireSameOrigin(req, res, ctx);
    assert.equal(ok, true);
});

test('requireSameOrigin: cross-origin returns 403 with /cross-origin/ message', () => {
    const { ctx, captured } = withMockCtx();
    const req = fakeReq({
        headers: {
            host: '127.0.0.1:5757',
            origin: 'http://evil.example',
        },
    });
    const res = fakeRes(captured);
    const ok = requireSameOrigin(req, res, ctx);
    assert.equal(ok, false);
    assert.equal(captured.status, 403);
    assert.equal(captured.body.success, false);
    assert.match(captured.body.message, /cross-origin/i);
});

test('requireSameOrigin: HTTPS Origin (https://127.0.0.1:5757) is rejected', () => {
    // The server only speaks plain HTTP, so `https://` is necessarily
    // a different origin.
    const { ctx, captured } = withMockCtx();
    const req = fakeReq({
        headers: {
            host: '127.0.0.1:5757',
            origin: 'https://127.0.0.1:5757',
        },
    });
    const res = fakeRes(captured);
    const ok = requireSameOrigin(req, res, ctx);
    assert.equal(ok, false);
    assert.equal(captured.status, 403);
});

test('requireSameOrigin: malformed Origin (`not a url`) is rejected', () => {
    const { ctx, captured } = withMockCtx();
    const req = fakeReq({
        headers: {
            host: '127.0.0.1:5757',
            origin: 'not a url',
        },
    });
    const res = fakeRes(captured);
    const ok = requireSameOrigin(req, res, ctx);
    assert.equal(ok, false);
    assert.equal(captured.status, 403);
});

test('requireSameOrigin: missing Host header (with Origin present) is rejected', () => {
    const { ctx, captured } = withMockCtx();
    const req = fakeReq({
        headers: { origin: 'http://127.0.0.1:5757' },
    });
    const res = fakeRes(captured);
    const ok = requireSameOrigin(req, res, ctx);
    assert.equal(ok, false);
    assert.equal(captured.status, 403);
});

// ---------------------------------------------------------------------------
// requireApiToken
// ---------------------------------------------------------------------------

test('requireApiToken: empty apiToken allows regardless of header', () => {
    const { ctx, captured } = withMockCtx({ apiToken: '' });
    const req = fakeReq({ headers: {} });
    const res = fakeRes(captured);
    const ok = requireApiToken(req, res, ctx);
    assert.equal(ok, true);
    assert.equal(captured.status, undefined);
});

test('requireApiToken: empty apiToken allows even with random Authorization header', () => {
    const { ctx, captured } = withMockCtx({ apiToken: '' });
    const req = fakeReq({ headers: { authorization: 'Bearer whatever' } });
    const res = fakeRes(captured);
    const ok = requireApiToken(req, res, ctx);
    assert.equal(ok, true);
});

test('requireApiToken: configured token, no header returns 401', () => {
    const { ctx, captured } = withMockCtx({ apiToken: 'secret' });
    const req = fakeReq({ headers: {} });
    const res = fakeRes(captured);
    const ok = requireApiToken(req, res, ctx);
    assert.equal(ok, false);
    assert.equal(captured.status, 401);
    assert.equal(captured.body.success, false);
});

test('requireApiToken: configured token, correct header allows', () => {
    const { ctx, captured } = withMockCtx({ apiToken: 'secret' });
    const req = fakeReq({ headers: { authorization: 'Bearer secret' } });
    const res = fakeRes(captured);
    const ok = requireApiToken(req, res, ctx);
    assert.equal(ok, true);
    assert.equal(captured.status, undefined);
});

test('requireApiToken: configured token, wrong header returns 401', () => {
    const { ctx, captured } = withMockCtx({ apiToken: 'secret' });
    const req = fakeReq({ headers: { authorization: 'Bearer wrong' } });
    const res = fakeRes(captured);
    const ok = requireApiToken(req, res, ctx);
    assert.equal(ok, false);
    assert.equal(captured.status, 401);
});

// ---------------------------------------------------------------------------
// readJsonBody
// ---------------------------------------------------------------------------

test('readJsonBody: valid JSON body resolves to parsed object', async () => {
    const { ctx, captured } = withMockCtx();
    const req = fakeReq({ body: '{"foo":1}' });
    const res = fakeRes(captured);
    const parsed = await readJsonBody<{ foo: number }>(req, res, ctx);
    assert.deepEqual(parsed, { foo: 1 });
    assert.equal(captured.status, undefined);
});

test('readJsonBody: invalid JSON returns null + 400 /invalid json/i', async () => {
    const { ctx, captured } = withMockCtx();
    const req = fakeReq({ body: '{not json' });
    const res = fakeRes(captured);
    const parsed = await readJsonBody(req, res, ctx);
    assert.equal(parsed, null);
    assert.equal(captured.status, 400);
    assert.equal(captured.body.success, false);
    assert.match(captured.body.message, /invalid json/i);
});

test('readJsonBody: empty body returns null + 400 (JSON.parse("") throws)', async () => {
    const { ctx, captured } = withMockCtx();
    const req = fakeReq({ body: '' });
    const res = fakeRes(captured);
    const parsed = await readJsonBody(req, res, ctx);
    assert.equal(parsed, null);
    assert.equal(captured.status, 400);
});

test('readJsonBody: oversized body returns null + 413 /too large/i', async () => {
    const { ctx, captured } = withMockCtx();
    const big = 'x'.repeat(100);
    const req = fakeReq({ body: big });
    const res = fakeRes(captured);
    const parsed = await readJsonBody(req, res, ctx, { maxBytes: 4 });
    assert.equal(parsed, null);
    assert.equal(captured.status, 413);
    assert.equal(captured.body.success, false);
    assert.match(captured.body.message, /too large/i);
});

test('readJsonBody: generic narrowing — `<{ path?: string }>` typechecks', async () => {
    // Compile-time check disguised as a runtime test. If the generic
    // parameter were dropped, `parsed?.path` would not narrow to
    // `string | undefined` and TS would reject the assignment.
    const { ctx, captured } = withMockCtx();
    const req = fakeReq({ body: '{"path":"foo/bar"}' });
    const res = fakeRes(captured);
    const parsed = await readJsonBody<{ path?: string }>(req, res, ctx);
    const p: string | undefined = parsed?.path;
    assert.equal(p, 'foo/bar');
});
