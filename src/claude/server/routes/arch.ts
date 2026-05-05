/**
 * GET/POST /api/arch — fetch or save a design document.
 *
 * Loop 11 extracted this from `GraphServer.setupApiEndpoints`. POST is the
 * only mutating verb and goes through `requireApiToken`. GET is read-only
 * and unauthenticated.
 *
 * Loop 06: migrated method gate, body read+parse, and auth call onto the
 * shared middleware in `./middleware`. Added a same-origin gate to POST
 * (mirrors `regenerate.ts`/`watch.ts`) — when `Origin` is present and
 * mismatched, the request is rejected 403 before auth runs. GET keeps its
 * current posture: no auth, no origin gate, read-only.
 */

import type * as http from 'http';
import {
    readJsonBody,
    requireApiToken,
    requireMethod,
    requireSameOrigin,
} from './middleware';
import type { ServerContext } from './types';

export async function handleArchRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ctx: ServerContext,
): Promise<void> {
    if (!requireMethod(req, res, ctx, ['GET', 'POST'])) return;
    if (req.method === 'GET') {
        return handleGetArch(req, res, ctx);
    }
    // POST path: same-origin gate + auth gate before the body is read.
    if (!requireSameOrigin(req, res, ctx)) return;
    if (!requireApiToken(req, res, ctx)) return;
    return handlePostArch(req, res, ctx);
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

    let doc: { markdown: string; html: string } | null;
    try {
        doc = await ctx.archWatcher.readDoc(docPath);
    } catch (err) {
        // L24: arch-watcher surfaces PathEscapeError up to the HTTP layer
        // when the requested path tries to escape `.arch/` (textual) or
        // its realpath escapes the workspace (symlink attack).
        if (err instanceof Error && err.name === 'PathEscapeError') {
            ctx.httpHandler.sendJson(res, 400, {
                success: false,
                message: `Invalid path: ${docPath}`,
            });
            return;
        }
        throw err;
    }
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
    const parsed = await readJsonBody<{ path?: string; markdown?: unknown }>(req, res, ctx);
    if (parsed === null) return; // 413 or 400 already sent.

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

    let success: boolean;
    try {
        success = await ctx.archWatcher.writeDoc(docPath, markdown);
    } catch (err) {
        // L24: writeDoc throws PathEscapeError on textual / realpath escape.
        if (err instanceof Error && err.name === 'PathEscapeError') {
            ctx.httpHandler.sendJson(res, 400, {
                success: false,
                message: `Invalid path: ${docPath}`,
            });
            return;
        }
        throw err;
    }
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
