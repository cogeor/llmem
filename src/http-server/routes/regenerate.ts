/**
 * POST /api/regenerate — force regenerate the graph (mutating).
 *
 * Loop 11 extracted this from `GraphServer.setupApiEndpoints` and put it
 * behind `requireApiToken` (when an apiToken is configured). Loop 18 added
 * a method gate and a same-origin gate that run BEFORE the auth check so
 * an unauthenticated probe gets 405/403 instead of 401 (and so a CSRF
 * `<img src=...>` GET cannot trigger a regeneration in local-dev mode where
 * `apiToken` is empty).
 *
 * Loop 06 migrated the three inline gates onto the shared middleware in
 * `./middleware`. The semantics are unchanged — see `middleware.ts` for the
 * gate contracts (method, same-origin, api-token) and the threat-model
 * notes lifted from this file.
 */

import type * as http from 'http';
import {
    requireApiToken,
    requireMethod,
    requireSameOrigin,
} from './middleware';
import type { ServerContext } from './types';

export async function handleRegenerateRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ctx: ServerContext,
): Promise<void> {
    // Order is load-bearing — method first (so probes with the wrong verb
    // get 405, not 401), same-origin next, api-token last. This matches
    // the original loop-18 inline ordering byte-for-byte.
    if (!requireMethod(req, res, ctx, ['POST'])) return;
    if (!requireSameOrigin(req, res, ctx)) return;
    if (!requireApiToken(req, res, ctx)) return;

    await ctx.regenerateWebview();
    ctx.httpHandler.sendJson(res, 200, {
        success: true,
        message: 'Graph regenerated',
    });
}
