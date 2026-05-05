/**
 * Shared HTTP route middleware.
 *
 * Loop 05: extracts the four reusable gates that previously lived
 * scattered across `regenerate.ts`, `watch.ts`, and `arch.ts` into
 * standalone helpers:
 *
 *   - `requireMethod` — 405 with `Allow` header on miss.
 *   - `requireSameOrigin` — 403 when `Origin` is present and cross-origin.
 *   - `requireApiToken` — 401 when `apiToken` is set and the bearer header
 *     doesn't match.
 *   - `readJsonBody` — buffers + parses a JSON body, with 413/400 handling.
 *
 * Loop 18 first added the method + same-origin gates inside
 * `regenerate.ts`; this module lifts the `isSameOrigin` / `normalizeLoopback`
 * helpers verbatim so the contract pinned by
 * `tests/integration/server-hardening.test.ts` is preserved byte-for-byte.
 *
 * Loop 06 (next loop) wires `regenerate.ts`, `watch.ts`, and `arch.ts` onto
 * these helpers. Loop 05 is intentionally additive only — no route changes.
 */

import type * as http from 'http';
import {
    BodyTooLargeError,
    readRequestBody,
    type ReadBodyOptions,
} from '../http-handler';
import { requireApiToken as requireApiTokenLegacy } from './auth';
import type { ServerContext } from './types';

export type { ReadBodyOptions };

/**
 * Method gate.
 *
 * Returns true when `req.method` (uppercased) is in `methods`. Otherwise
 * sets `Allow: <methods.join(', ')>`, sends 405 via
 * `ctx.httpHandler.sendJson`, and returns false.
 *
 * Header order is load-bearing: `setHeader` MUST run before `sendJson` so
 * the `Allow` header survives `writeHead`. This matches the pattern
 * established in `regenerate.ts` (Loop 18).
 */
export function requireMethod(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ctx: ServerContext,
    methods: readonly string[],
): boolean {
    const method = (req.method ?? '').toUpperCase();
    if (methods.includes(method)) {
        return true;
    }
    // `setHeader` merges with the headers `sendJson` -> `writeHead`
    // passes; `Allow` survives in the final response.
    res.setHeader('Allow', methods.join(', '));
    ctx.httpHandler.sendJson(res, 405, {
        success: false,
        message: `Method ${req.method ?? 'unknown'} not allowed`,
    });
    return false;
}

/**
 * Same-origin gate.
 *
 * **Threat model**: this is a CSRF defense for the local-dev mode
 * where `apiToken` is empty (the server still binds 127.0.0.1, but a
 * malicious page in the user's browser could otherwise issue a
 * `<form action="http://127.0.0.1:5757/api/regenerate">` POST). The
 * configured `apiToken` (when set) remains the strong gate; this
 * helper is purely belt-and-braces.
 *
 * **What this does NOT defend against**: full CSRF in the
 * synchronizer-token sense. The `Origin` header is absent on certain
 * fetches (curl, server-to-server, some same-origin browser flows
 * that pre-date the header), so we allow `Origin`-absent traffic
 * (Loop 18 Decision #1). Reviewers: do NOT add a hidden-token CSRF
 * scheme here; the threat surface is the local 127.0.0.1 listener
 * and a non-empty `apiToken` is the supported hardening path.
 *
 * Returns true to continue. Returns false (and writes 403) when
 * `Origin` is present, non-empty, and does not match the request's
 * `Host` after `localhost`/`127.0.0.1` canonicalisation.
 */
export function requireSameOrigin(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ctx: ServerContext,
): boolean {
    // `ctx` is currently unused for the comparison itself but is taken for
    // (a) symmetry with the other helpers and (b) future port-binding
    // override (compare against `ctx.config.port` instead of relying on
    // the `Host` header in environments where Host is rewritten by a
    // reverse proxy — out of scope for this loop).
    void ctx;

    const originHeader = req.headers['origin'];
    if (typeof originHeader !== 'string' || originHeader.length === 0) {
        // Absent or empty Origin is allowed (Decision #1 in PLAN.md Loop 18).
        return true;
    }
    if (isSameOrigin(originHeader, req)) {
        return true;
    }
    ctx.httpHandler.sendJson(res, 403, {
        success: false,
        message: 'Cross-origin request rejected',
    });
    return false;
}

/**
 * API token gate.
 *
 * Empty `ctx.config.apiToken` ⇒ allow (local-dev mode). When configured,
 * the request must carry `Authorization: Bearer <token>` byte-for-byte;
 * otherwise 401.
 *
 * Implemented as a thin context-shaped wrapper around the existing
 * `auth.ts:requireApiToken` so the comparison logic lives in exactly one
 * place during loop 05/06. Loop 06 (or a follow-up cleanup) deletes the
 * `auth.ts` copy once all callers have migrated.
 */
export function requireApiToken(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ctx: ServerContext,
): boolean {
    return requireApiTokenLegacy(req, res, ctx.config, ctx.httpHandler);
}

/**
 * Buffer the request body, parse it as JSON, and return the parsed value
 * (typed as `T`). Returns `null` on body-too-large (sends 413) or JSON
 * parse failure (sends 400). Other read errors are rethrown — the outer
 * route handler in `http-handler.ts:handle` catches and sends 500.
 *
 * Schema validation is **out of scope** here; field-level checks
 * (`if (!docPath)`, `typeof markdown !== 'string'`, ...) stay at the
 * route-handler layer. The generic `<T>` is purely a compile-time
 * convenience for narrowing.
 *
 * Error response strings match `arch.ts` / `watch.ts` byte-for-byte.
 */
export async function readJsonBody<T = unknown>(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ctx: ServerContext,
    opts?: ReadBodyOptions,
): Promise<T | null> {
    let body: string;
    try {
        body = await readRequestBody(req, opts);
    } catch (err) {
        if (err instanceof BodyTooLargeError) {
            ctx.httpHandler.sendJson(res, 413, {
                success: false,
                message: 'Request body too large',
            });
            return null;
        }
        throw err;
    }

    try {
        return JSON.parse(body) as T;
    } catch {
        ctx.httpHandler.sendJson(res, 400, {
            success: false,
            message: 'Invalid JSON body',
        });
        return null;
    }
}

// ---------------------------------------------------------------------------
// Private helpers (lifted verbatim from `regenerate.ts`, Loop 18).
//
// Loop 05 leaves the originals in `regenerate.ts` in place to keep this
// loop pure-additive; Loop 06 deletes them when migrating that route to
// `requireSameOrigin`.
// ---------------------------------------------------------------------------

/**
 * Returns true when `originHeader`'s host:port matches the request's
 * `Host` header. Both `127.0.0.1:<port>` and `localhost:<port>` are
 * accepted as equivalents for either side, since the server binds plain
 * HTTP on `127.0.0.1` and browsers may resolve `localhost` either way.
 *
 * The scheme must be `http:` — the server only speaks plain HTTP, so an
 * `https://` Origin is necessarily a different origin.
 *
 * Returns false on parse failure (malformed Origin URL).
 */
function isSameOrigin(originHeader: string, req: http.IncomingMessage): boolean {
    let originUrl: URL;
    try {
        originUrl = new URL(originHeader);
    } catch {
        return false;
    }

    if (originUrl.protocol !== 'http:') return false;

    const hostHeader = req.headers.host;
    if (typeof hostHeader !== 'string' || hostHeader.length === 0) return false;

    // Normalize both sides so `127.0.0.1` and `localhost` are
    // interchangeable for the same port.
    const originHost = normalizeLoopback(originUrl.host);
    const requestHost = normalizeLoopback(hostHeader);
    return originHost === requestHost;
}

function normalizeLoopback(hostPort: string): string {
    // `URL.host` and `req.headers.host` are both `host:port` (or just
    // `host` if the default port is in use; the server here always binds
    // an explicit port, so `host:port` is the expected shape).
    const colonIdx = hostPort.lastIndexOf(':');
    const host = colonIdx === -1 ? hostPort : hostPort.slice(0, colonIdx);
    const port = colonIdx === -1 ? '' : hostPort.slice(colonIdx);
    const canonicalHost = host === 'localhost' ? '127.0.0.1' : host;
    return `${canonicalHost}${port}`;
}
