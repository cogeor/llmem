/**
 * Route registrar.
 *
 * Loop 11: aggregates the per-route handlers under `routes/` and wires them
 * into the shared `HttpRequestHandler` registry. The server lifecycle
 * (`GraphServer.start`) calls `registerRoutes(ctx)` once at startup.
 *
 * Adding a new route = create `routes/{name}.ts`, import its handler here,
 * register it. Each handler signature is `(req, res, ctx) => Promise<void>`.
 */

import { handleArchRoute } from './arch';
import { handleFolderEdgesRoute } from './folder-edges';
import { handleFolderTreeRoute } from './folder-tree';
import { handleRegenerateRoute } from './regenerate';
import { handleStatsRoute } from './stats';
import { handleWatchRoute } from './watch';
import { handleWatchedRoute } from './watched';
import type { ServerContext } from './types';

export type { ServerContext } from './types';
// Loop 06: middleware helpers are the canonical export. The previous
// `requireApiToken` re-export pointed at `routes/auth.ts`, which has been
// deleted; the inlined body now lives in `routes/middleware.ts`.
export {
    readJsonBody,
    requireApiToken,
    requireMethod,
    requireSameOrigin,
} from './middleware';

/**
 * Wire every route into `ctx.httpHandler`'s API registry. Idempotent in the
 * sense that re-registering a path overwrites the previous handler.
 */
export function registerRoutes(ctx: ServerContext): void {
    ctx.httpHandler.registerApiHandler('/api/stats', (req, res) =>
        handleStatsRoute(req, res, ctx),
    );
    ctx.httpHandler.registerApiHandler('/api/regenerate', (req, res) =>
        handleRegenerateRoute(req, res, ctx),
    );
    ctx.httpHandler.registerApiHandler('/api/watched', (req, res) =>
        handleWatchedRoute(req, res, ctx),
    );
    ctx.httpHandler.registerApiHandler('/api/watch', (req, res) =>
        handleWatchRoute(req, res, ctx),
    );
    ctx.httpHandler.registerApiHandler('/api/arch', (req, res) =>
        handleArchRoute(req, res, ctx),
    );
    ctx.httpHandler.registerApiHandler('/api/folder-edges', (req, res) =>
        handleFolderEdgesRoute(req, res, ctx),
    );
    ctx.httpHandler.registerApiHandler('/api/folder-tree', (req, res) =>
        handleFolderTreeRoute(req, res, ctx),
    );
}
