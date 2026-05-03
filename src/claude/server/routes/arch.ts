/**
 * GET/POST /api/arch — fetch or save a design document.
 *
 * Loop 11 extracted this from `GraphServer.setupApiEndpoints`. POST is the
 * only mutating verb and goes through `requireApiToken`. GET is read-only
 * and unauthenticated.
 */

import type * as http from 'http';
import {
    BodyTooLargeError,
    readRequestBody,
} from '../http-handler';
import { requireApiToken } from './auth';
import type { ServerContext } from './types';

export async function handleArchRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ctx: ServerContext,
): Promise<void> {
    if (req.method === 'GET') {
        return handleGetArch(req, res, ctx);
    }
    if (req.method === 'POST') {
        if (!requireApiToken(req, res, ctx.config, ctx.httpHandler)) return;
        return handlePostArch(req, res, ctx);
    }
    ctx.httpHandler.sendJson(res, 405, {
        success: false,
        message: `Method ${req.method} not allowed`,
    });
}

async function handleGetArch(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ctx: ServerContext,
): Promise<void> {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const docPath = url.searchParams.get('path');

    if (!docPath) {
        ctx.httpHandler.sendJson(res, 400, {
            success: false,
            message: 'Missing "path" query parameter',
        });
        return;
    }

    const doc = await ctx.archWatcher.readDoc(docPath);
    if (doc) {
        ctx.httpHandler.sendJson(res, 200, {
            success: true,
            path: docPath,
            markdown: doc.markdown,
            html: doc.html,
        });
    } else {
        ctx.httpHandler.sendJson(res, 404, {
            success: false,
            message: `Design doc not found: ${docPath}`,
        });
    }
}

async function handlePostArch(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ctx: ServerContext,
): Promise<void> {
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

    let parsed: { path?: string; markdown?: unknown };
    try {
        parsed = JSON.parse(body);
    } catch {
        ctx.httpHandler.sendJson(res, 400, {
            success: false,
            message: 'Invalid JSON body',
        });
        return;
    }

    const { path: docPath, markdown } = parsed;

    if (!docPath) {
        ctx.httpHandler.sendJson(res, 400, {
            success: false,
            message: 'Missing "path" in request body',
        });
        return;
    }

    if (typeof markdown !== 'string') {
        ctx.httpHandler.sendJson(res, 400, {
            success: false,
            message: 'Missing or invalid "markdown" in request body',
        });
        return;
    }

    const success = await ctx.archWatcher.writeDoc(docPath, markdown);
    if (success) {
        // The file watcher will detect the change and broadcast update
        ctx.httpHandler.sendJson(res, 200, {
            success: true,
            message: 'Design doc saved',
            path: docPath,
        });
    } else {
        ctx.httpHandler.sendJson(res, 500, {
            success: false,
            message: 'Failed to save design doc',
        });
    }
}
