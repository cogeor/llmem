/**
 * LLMem Graph Server
 *
 * HTTP server with WebSocket live reload and file watching.
 *
 * Loop 11 + B8: per-route handlers live in `./routes/`; browser-open,
 * regeneration, stateless lifecycle helpers, the dependency-bundle
 * builders, and `ServerConfig` live in their respective siblings. This
 * file owns the `GraphServer` class shell (start/stop wiring) + `startServer`.
 */

import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { WebSocketService } from './websocket';
import { FileWatcherService } from './file-watcher';
import { HttpRequestHandler } from './http-handler';
import { WatchManager } from './watch-manager';
import { ArchWatcherService } from './arch-watcher';
import type { Logger as BoundaryLogger } from '../core/logger';
import { createLogger } from '../common/logger';
import { registerRoutes } from './routes';
import { openBrowser } from './open-browser';
import { initWorkspaceContext, type WorkspaceContext } from '../application/workspace-context';
import {
    broadcastArchEvent,
    regenerateWebview as regenerateWebviewImpl,
    rescanSourcesAndRegenerate,
} from './regenerator';
import {
    bindWithPortFallback,
    coldStartScan,
    printServerInfo,
} from './server-lifecycle';
import {
    buildServerContext,
    buildRegenDeps,
    type ServerParts,
} from './server-context';
import { type ServerConfig, normalizeConfig } from './server-config';
import { DEFAULT_PORT } from '../config-defaults';

const log = createLogger('graph-server');

// B8: `ServerConfig` lives in `./server-config` (breaks the index ↔
// server-context import cycle). Re-exported so the public surface
// (`import { ServerConfig } from '../http-server'`) is unchanged.
export type { ServerConfig } from './server-config';

/**
 * Main Graph Server - orchestrates all services
 */
export class GraphServer {
    private httpServer: http.Server | null = null;
    private webSocket: WebSocketService;
    // Loop 04: these four need a `WorkspaceContext`, built async in
    // `start()` (realpath canonicalization can't run in the sync ctor).
    // `!` asserts the lifecycle invariant: `start()` runs before any
    // method that touches them.
    private fileWatcher!: FileWatcherService;
    private httpHandler: HttpRequestHandler;
    private watchManager!: WatchManager;
    private archWatcher!: ArchWatcherService;
    private _ctx!: WorkspaceContext;

    private config: Required<ServerConfig>;
    private webviewDir: string;
    private isRegenerating = false;

    // Loop 20: bridge the boundary `Logger` onto the structured logger.
    // `info` is gated on `verbose` so non-verbose mode prints only
    // warnings/errors (the structured logger has its own LOG_LEVEL gate).
    private readonly serverLogger: BoundaryLogger = {
        info: (m) => { if (this.config.verbose) log.info(m); },
        warn: (m) => log.warn(m),
        error: (m) => log.error(m),
    };

    constructor(config: ServerConfig) {
        this.config = normalizeConfig(config);
        const { verbose } = this.config;
        this.webviewDir = path.join(path.resolve(this.config.workspaceRoot, this.config.artifactRoot), 'webview');

        this.webSocket = new WebSocketService(verbose);
        this.httpHandler = new HttpRequestHandler({ webviewDir: this.webviewDir, verbose });
        // L24: file/arch watcher + watch manager move to start() (they need
        // an async-constructed WorkspaceIO in their config).
    }

    /** Start the server. */
    async start(): Promise<void> {
        const { workspaceRoot, verbose } = this.config;

        // Loop 04: per-server runtime context, built once and threaded to
        // every downstream service (watchers, watch manager, regenerator).
        this._ctx = await initWorkspaceContext({
            workspaceRoot,
            configOverrides: {
                artifactRoot: this.config.artifactRoot,
                apiToken: this.config.apiToken || undefined,
                port: this.config.port,
            },
            logger: this.serverLogger,
        });

        this.fileWatcher = new FileWatcherService(this._ctx, verbose);
        this.watchManager = new WatchManager(this._ctx, verbose);
        this.archWatcher = new ArchWatcherService(this._ctx, verbose);

        await coldStartScan(this._ctx);

        if (!fs.existsSync(this.webviewDir)) {
            log.info('Generating graph...');
            await this.regenerateWebview();
        }

        await this.watchManager.initialize();

        this.httpServer = http.createServer((req, res) => {
            this.httpHandler.handle(req, res);
        });
        // Loop 02: WS setup is deferred until after the listen loop (below).
        // WebSocketServer attaches a permanent http-server `error` listener
        // that re-emits as uncaught; binding it before the port-fallback
        // walk would crash on the first EADDRINUSE. Upgrade events only
        // matter once listening, so deferring is behavior-preserving.

        registerRoutes(buildServerContext(this.parts()));

        await this.fileWatcher.setup({
            onSourceChange: async (files) => await this.handleSourceChange(files),
            onEdgeListChange: async () => await this.handleEdgeListChange(),
        });

        log.info('Setting up ArchWatcher...');
        await this.archWatcher.setup((event) =>
            broadcastArchEvent(event, this.webSocket),
        );
        log.info('ArchWatcher setup complete');

        // B8: auto-port-fallback walk in server-lifecycle.ts. Silent
        // fallback; the bound port is announced once by printServerInfo below.
        this.config.port = await bindWithPortFallback(this.httpServer!, this.config.port);
        // Loop 02: deferred from before the listen loop — see comment above.
        this.webSocket.setup(this.httpServer!);
        printServerInfo({
            watchedFileCount: this.fileWatcher.getWatchedFileCount(),
            url: `http://127.0.0.1:${this.getPort()}`,
            webviewDir: this.webviewDir,
            workspaceRoot: this.config.workspaceRoot,
        });

        if (this.config.openBrowser) {
            openBrowser(`http://127.0.0.1:${this.getPort()}`);
        }
    }

    /** Stop the server. */
    async stop(): Promise<void> {
        // L24: watchers are built in `start()`; tolerate `stop()` before
        // `start()` ever ran (e.g. early-aborted lifecycle).
        if (this.fileWatcher) await this.fileWatcher.close();
        if (this.archWatcher) await this.archWatcher.close();
        await this.webSocket.close();
        if (this.httpServer) {
            await new Promise<void>((resolve) => {
                this.httpServer!.close(() => {
                    log.info('Server stopped');
                    resolve();
                });
            });
            this.httpServer = null;
        }
    }

    /** Get the actual port the server is listening on (useful when port=0). */
    getPort(): number {
        if (!this.httpServer) return this.config.port;
        const addr = this.httpServer.address();
        if (addr && typeof addr === 'object') return addr.port;
        return this.config.port;
    }

    /** Snapshot of live state the B8-extracted builders read from. */
    private parts(): ServerParts {
        return {
            config: this.config,
            ctx: this._ctx,
            logger: this.serverLogger,
            webSocket: this.webSocket,
            watchManager: this.watchManager,
            archWatcher: this.archWatcher,
            httpHandler: this.httpHandler,
            regenerateWebview: () => this.regenerateWebview(),
        };
    }

    private async regenerateWebview(): Promise<void> {
        await regenerateWebviewImpl(buildRegenDeps(this.parts()));
    }

    private handleSourceChange(files: string[]): Promise<void> {
        return this.runGuarded('Error regenerating edges', () =>
            rescanSourcesAndRegenerate(files, buildRegenDeps(this.parts())),
        );
    }

    private handleEdgeListChange(): Promise<void> {
        return this.runGuarded('Error regenerating webview', () =>
            this.regenerateWebview(),
        );
    }

    // Run `work` under the single-flight `isRegenerating` latch, dropping
    // re-entrant ticks and logging (not rejecting on) failures under
    // `errLabel`. Shared by both watcher callbacks.
    private async runGuarded(errLabel: string, work: () => Promise<void>): Promise<void> {
        if (this.isRegenerating) return;
        this.isRegenerating = true;
        try {
            await work();
        } catch (error) {
            log.error(errLabel, {
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            this.isRegenerating = false;
        }
    }
}

/**
 * Start server with default configuration
 */
export async function startServer(
    workspaceRoot: string,
    port: number = DEFAULT_PORT,
): Promise<GraphServer> {
    const server = new GraphServer({
        workspaceRoot,
        port,
        openBrowser: false,
        verbose: false,
    });

    await server.start();
    return server;
}
