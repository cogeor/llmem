/**
 * API token enforcement for mutating routes.
 *
 * Loop 11: previously only POST `/api/arch` checked `apiToken`. This helper
 * unifies the contract across every mutating route.
 *
 * Semantics (also documented in PLAN.md task 11.5):
 *
 *   - `config.apiToken` is undefined OR empty string  → request is allowed.
 *     This is local-dev mode: when no token is configured, the server runs
 *     unauthenticated. The bind address is 127.0.0.1 so this is a local-only
 *     surface; configuring a token is the way to harden it.
 *
 *   - `config.apiToken` is set, request has matching `Authorization: Bearer
 *     <token>` header  → request is allowed.
 *
 *   - `config.apiToken` is set, request is missing the header OR the token
 *     does not match  → 401 is sent and the function returns false. The
 *     caller must NOT continue.
 *
 * Returning a boolean (rather than throwing) keeps the call sites flat:
 *
 *   ```
 *   if (!requireApiToken(req, res, ctx.config, ctx.httpHandler)) return;
 *   // ...mutating logic...
 *   ```
 */

import type * as http from 'http';
import type { HttpRequestHandler } from '../http-handler';

export function requireApiToken(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    config: { apiToken?: string },
    httpHandler: HttpRequestHandler,
): boolean {
    const configured = config.apiToken;
    if (!configured) {
        // Local dev mode: no token configured, accept the request.
        return true;
    }

    const authHeader = req.headers['authorization'] ?? '';
    const expected = `Bearer ${configured}`;
    if (authHeader === expected) {
        return true;
    }

    httpHandler.sendJson(res, 401, {
        success: false,
        message: 'Unauthorized',
    });
    return false;
}
