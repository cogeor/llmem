/**
 * GET /api/stats — graph statistics (read-only).
 *
 * Loop 11 extracted this from `GraphServer.setupApiEndpoints`. The route is
 * read-only and not gated by `requireApiToken`.
 *
 * Loop 04: `getGraphStats` takes the server's `WorkspaceContext` directly.
 */

import type * as http from 'http';
import { getGraphStats } from '../../web-launcher';
import type { ServerContext } from './types';

export async function handleStatsRoute(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    ctx: ServerContext,
): Promise<void> {
    const stats = await getGraphStats(ctx.ctx);
    ctx.httpHandler.sendJson(res, 200, stats);
}
