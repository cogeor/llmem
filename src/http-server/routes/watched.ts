/**
 * GET /api/watched — return watched-file state (read-only).
 *
 * Loop 11 extracted this from `GraphServer.setupApiEndpoints`. The route is
 * read-only and not gated by `requireApiToken`.
 */

import type * as http from 'http';
import type { ServerContext } from './types';

export async function handleWatchedRoute(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    ctx: ServerContext,
): Promise<void> {
    const state = ctx.watchManager.getWatchState();
    ctx.httpHandler.sendJson(res, 200, state);
}
