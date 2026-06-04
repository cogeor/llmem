/**
 * GraphServer dependency-bundle builders.
 *
 * B8: extracted from `index.ts` so the `GraphServer` class shell stays
 * under the 250-line platform-handler budget. These builders translate the
 * server's long-lived state into the two payloads downstream code consumes
 * — the `ServerContext` route handlers receive and the `RegenerateDeps`
 * the regenerator receives. They take the live `parts` explicitly so they
 * stay free functions (no `this`); the class threads its own fields in.
 */

import type { ServerContext } from './routes';
import type { RegenerateDeps } from './regenerator';
import type { Logger as BoundaryLogger } from '../core/logger';
import type { WorkspaceContext } from '../application/workspace-context';
import type { WebSocketService } from './websocket';
import type { WatchManager } from './watch-manager';
import type { ArchWatcherService } from './arch-watcher';
import type { HttpRequestHandler } from './http-handler';
import type { ServerConfig } from './server-config';

/**
 * The live server state the builders read from. Mirrors the subset of
 * `GraphServer` fields each payload needs; the class passes `this`-bound
 * values in so these functions can stay `this`-free.
 */
export interface ServerParts {
    config: Required<ServerConfig>;
    ctx: WorkspaceContext;
    logger: BoundaryLogger;
    webSocket: WebSocketService;
    watchManager: WatchManager;
    archWatcher: ArchWatcherService;
    httpHandler: HttpRequestHandler;
    regenerateWebview: () => Promise<void>;
}

/** Build the dependency bundle that route handlers consume. */
export function buildServerContext(parts: ServerParts): ServerContext {
    return {
        config: parts.config,
        ctx: parts.ctx,
        logger: parts.logger,
        watchManager: parts.watchManager,
        archWatcher: parts.archWatcher,
        httpHandler: parts.httpHandler,
        regenerateWebview: parts.regenerateWebview,
    };
}

/** Build the regenerator dependency bundle. */
export function buildRegenDeps(parts: ServerParts): RegenerateDeps {
    return {
        ctx: parts.ctx,
        verbose: parts.config.verbose,
        webSocket: parts.webSocket,
        logger: parts.logger,
        // '' (no override) is normalized to undefined so the launcher
        // falls back to its discovery chain.
        assetRoot: parts.config.assetRoot || undefined,
    };
}
