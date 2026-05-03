/**
 * Route handler context.
 *
 * Loop 11 split per-route handlers out of `GraphServer`. Routes don't take
 * a reference to the server class; they take a small `ServerContext` with
 * exactly the dependencies they need. This keeps each route file
 * standalone-testable and avoids growing a back-reference graph.
 *
 * The lifecycle (start/stop, websocket broadcasting, file watcher) stays
 * in `GraphServer`; only the request-handling surface goes through here.
 */

import type { Logger } from '../../../core/logger';
import type { ServerConfig } from '../index';
import type { HttpRequestHandler } from '../http-handler';
import type { WatchManager } from '../watch-manager';
import type { ArchWatcherService } from '../arch-watcher';

/**
 * Bundle of dependencies passed to every route handler. Built once by the
 * server during `start()` and shared across all routes.
 *
 * - `config`: validated `Required<ServerConfig>` so route code can read
 *   `apiToken`, `workspaceRoot`, etc. without optional-chain noise.
 * - `logger`: structured logger; routes MUST NOT use `console.*`.
 * - `watchManager`, `archWatcher`: shared service singletons.
 * - `httpHandler`: only used for `sendJson`/`sendError` helpers.
 * - `regenerateWebview`: callback into `GraphServer` for the regen flow.
 */
export interface ServerContext {
    config: Required<ServerConfig>;
    logger: Logger;
    watchManager: WatchManager;
    archWatcher: ArchWatcherService;
    httpHandler: HttpRequestHandler;
    regenerateWebview: () => Promise<void>;
}
