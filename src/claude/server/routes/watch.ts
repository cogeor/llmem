/**
 * POST/DELETE /api/watch — add/remove a watched path (mutating).
 *
 * Loop 11 extracted this from `GraphServer.setupApiEndpoints`. Both
 * mutating verbs are now gated by `requireApiToken`. The actual edge-list
 * mutation lives in `application/toggle-watch`; this handler is a thin
 * HTTP wrapper around it.
 *
 * Loop 04: `addWatchedPath` / `removeWatchedPath` take the server's
 * `WorkspaceContext` plus a `{ targetPath }` request, so the inline
 * `path.join(workspaceRoot, artifactRoot)` derivation is gone.
 */

import * as http from 'http';
import { addWatchedPath, removeWatchedPath } from '../../../application/toggle-watch';
import { asRelPath } from '../../../core/paths';
import {
    BodyTooLargeError,
    readRequestBody,
} from '../http-handler';
import { requireApiToken } from './auth';
import type { ServerContext } from './types';

export async function handleWatchRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ctx: ServerContext,
): Promise<void> {
    if (req.method !== 'POST' && req.method !== 'DELETE') {
        ctx.httpHandler.sendJson(res, 405, {
            success: false,
            message: `Method ${req.method} not allowed`,
        });
        return;
    }

    if (!requireApiToken(req, res, ctx.config, ctx.httpHandler)) return;

    let body: string;
    try {
        body = await readRequestBody(req);
    } catch (err) {
        if (err instanceof BodyTooLargeError) {
            ctx.httpHandler.sendJson(res, 413, {
                success: false,
                message: 'Request body too large',
            });
            return;
        }
        throw err;
    }

    let parsed: { path?: string };
    try {
        parsed = JSON.parse(body);
    } catch {
        ctx.httpHandler.sendJson(res, 400, {
            success: false,
            message: 'Invalid JSON body',
        });
        return;
    }

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
