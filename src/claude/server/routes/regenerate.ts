/**
 * POST /api/regenerate — force regenerate the graph (mutating).
 *
 * Loop 11 extracted this from `GraphServer.setupApiEndpoints` and put it
 * behind `requireApiToken` (when an apiToken is configured).
 *
 * Loop 18 added two cheap gates that run BEFORE the auth check so an
 * unauthenticated probe gets 405/403 instead of 401 (and so a CSRF
 * `<img src=...>` GET cannot trigger a regeneration in local-dev mode
 * where `apiToken` is empty):
 *
 *   1. Method gate: only `POST` is accepted; everything else returns
 *      `405 Method Not Allowed` with `Allow: POST`.
 *   2. Same-origin gate: when the `Origin` header is present, it must
 *      match the request's `Host` (i.e. `127.0.0.1:<port>` or
 *      `localhost:<port>`) over plain `http`; otherwise 403. When
 *      `Origin` is absent (curl, server-to-server, certain same-origin
 *      browser flows), the request is ALLOWED — see PLAN.md Loop 18,
 *      Decision #1. The configured `apiToken` (when set) remains the
 *      strong gate; `Origin` is purely a CSRF defense for empty-token
 *      local-dev usage.
 */

import type * as http from 'http';
import { requireApiToken } from './auth';
import type { ServerContext } from './types';

export async function handleRegenerateRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ctx: ServerContext,
): Promise<void> {
    // 1. Method gate. Run before auth so a probe with the wrong verb gets
    //    405 (informative) instead of 401 (which would also leak that the
    //    URL exists on a sensitive verb).
    if (req.method !== 'POST') {
        // `setHeader` merges with the headers `sendJson` -> `writeHead`
        // passes; `Allow` survives in the final response.
        res.setHeader('Allow', 'POST');
        ctx.httpHandler.sendJson(res, 405, {
            success: false,
            message: `Method ${req.method ?? 'unknown'} not allowed`,
        });
        return;
    }

    // 2. Same-origin gate. Only enforced when `Origin` is present; absent
    //    `Origin` is allowed (Decision #1 in PLAN.md Loop 18).
    const originHeader = req.headers['origin'];
    if (typeof originHeader === 'string' && originHeader.length > 0) {
        if (!isSameOrigin(originHeader, req)) {
            ctx.httpHandler.sendJson(res, 403, {
                success: false,
                message: 'Cross-origin request rejected',
            });
            return;
        }
    }

    // 3. Existing auth gate (unchanged).
    if (!requireApiToken(req, res, ctx.config, ctx.httpHandler)) return;

    await ctx.regenerateWebview();
    ctx.httpHandler.sendJson(res, 200, {
        success: true,
        message: 'Graph regenerated',
    });
}

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
