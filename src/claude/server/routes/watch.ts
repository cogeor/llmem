/**
 * POST/DELETE /api/watch — add/remove a watched path (mutating).
 *
 * Loop 11 extracted this from `GraphServer.setupApiEndpoints`. Both
 * mutating verbs are gated by `requireApiToken`. The actual edge-list
 * mutation lives in `application/toggle-watch`; this handler is a thin
 * HTTP wrapper around it.
 *
 * Loop 04: `addWatchedPath` / `removeWatchedPath` take the server's
 * `WorkspaceContext` plus a `{ targetPath }` request, so the inline
 * `path.join(workspaceRoot, artifactRoot)` derivation is gone.
 *
 * Loop 06: migrated method check, body read+parse, and auth call onto
 * the shared middleware in `./middleware`. Added a same-origin gate
 * (mirrors `regenerate.ts`) — when `Origin` is present and mismatched,
 * the request is rejected 403 before auth runs. Absent `Origin` is
 * allowed (Decision #1, Loop 18).
 */

import * as http from 'http';
import { addWatchedPath, removeWatchedPath } from '../../../application/toggle-watch';
import { asRelPath } from '../../../core/paths';
import {
    readJsonBody,
    requireApiToken,
    requireMethod,
    requireSameOrigin,
} from './middleware';
import type { ServerContext } from './types';

export async function handleWatchRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ctx: ServerContext,
): Promise<void> {
    if (!requireMethod(req, res, ctx, ['POST', 'DELETE'])) return;
    if (!requireSameOrigin(req, res, ctx)) return;
    if (!requireApiToken(req, res, ctx)) return;

    const parsed = await readJsonBody<{ path?: string }>(req, res, ctx);
    if (parsed === null) return; // 413 or 400 already sent.

    const { path: relativePath } = parsed;
    if (!relativePath) {
        ctx.httpHandler.sendJson(res, 400, {
            success: false,
            message: 'Missing "path" parameter',
        });
        return;
    }

    const toggleReq = {
        targetPath: asRelPath(relativePath),
    };

    if (req.method === 'POST') {
        const result = await addWatchedPath(ctx.ctx, toggleReq);
        if (result.success) {
            await ctx.watchManager.refresh();
            await ctx.regenerateWebview();
        }
        ctx.httpHandler.sendJson(res, result.success ? 200 : 400, result);
    } else {
        // DELETE
        const result = await removeWatchedPath(ctx.ctx, toggleReq);
        if (result.success) {
            await ctx.watchManager.refresh();
            await ctx.regenerateWebview();
        }
        ctx.httpHandler.sendJson(res, result.success ? 200 : 400, result);
    }
}
