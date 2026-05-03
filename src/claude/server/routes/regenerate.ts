/**
 * POST /api/regenerate — force regenerate the graph (mutating).
 *
 * Loop 11 extracted this from `GraphServer.setupApiEndpoints` and put it
 * behind `requireApiToken` (when an apiToken is configured).
 */

import type * as http from 'http';
import { requireApiToken } from './auth';
import type { ServerContext } from './types';

export async function handleRegenerateRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ctx: ServerContext,
): Promise<void> {
    if (!requireApiToken(req, res, ctx.config, ctx.httpHandler)) return;

    await ctx.regenerateWebview();
    ctx.httpHandler.sendJson(res, 200, {
        success: true,
        message: 'Graph regenerated',
    });
}
