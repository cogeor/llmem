/**
 * GET /api/folder-tree — folder-tree artifact (read-only).
 *
 * Loop 12. The route is read-only and not gated by `requireApiToken`.
 * On missing artifact (no scan has run yet), responds 404 with a structured
 * error body — the UI uses the `error` discriminant to render a useful
 * "run `llmem scan` first" prompt. The static-webview path (loop 11) reads
 * `window.FOLDER_TREE` instead and never hits this endpoint.
 */

import type * as http from 'http';
import { FolderTreeStore } from '../../../graph/folder-tree-store';
import { FolderTreeLoadError } from '../../../graph/folder-tree';
import type { ServerContext } from './types';

export async function handleFolderTreeRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ctx: ServerContext,
): Promise<void> {
    if (req.method !== 'GET') {
        ctx.httpHandler.sendJson(res, 405, {
            error: 'METHOD_NOT_ALLOWED',
            message: `Method ${req.method} not allowed`,
        });
        return;
    }

    try {
        // Loop 04: artifactRoot lives on the server's WorkspaceContext;
        // we no longer recompute path.join(workspaceRoot, artifactRoot).
        const data = await new FolderTreeStore(ctx.ctx.artifactRoot, ctx.ctx.io).load();
        ctx.httpHandler.sendJson(res, 200, data);
    } catch (err) {
        if (err instanceof FolderTreeLoadError) {
            ctx.httpHandler.sendJson(res, 404, {
                error: 'NOT_FOUND',
                message: 'No folder tree available — run `llmem scan` first.',
            });
            return;
        }
        throw err;
    }
}
