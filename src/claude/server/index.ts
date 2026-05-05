/**
 * LLMem Graph Server
 *
 * HTTP server with WebSocket live reload and file watching.
 *
 * Loop 11: per-route handlers moved to `./routes/`. Browser-open and
 * regeneration helpers moved to `./open-browser.ts` and `./regenerator.ts`.
 * This file owns lifecycle wiring (start/stop, file watcher, websocket)
 * and builds the `ServerContext` that routes consume.
 */

import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { WebSocketService } from './websocket';
import { FileWatcherService } from './file-watcher';
import { HttpRequestHandler } from './http-handler';
import { WatchManager } from './watch-manager';
import { ArchWatcherService } from './arch-watcher';
import type { Logger as BoundaryLogger } from '../../core/logger';
import { createLogger } from '../../common/logger';
import { registerRoutes } from './routes';
import type { ServerContext } from './routes';
import { openBrowser } from './open-browser';
import { createWorkspaceContext, type WorkspaceContext } from '../../application/workspace-context';
import {
    broadcastArchEvent,
    regenerateWebview as regenerateWebviewImpl,
    rescanSourcesAndRegenerate,
    type RegenerateDeps,
} from './regenerator';
import { DEFAULT_PORT } from '../../config-defaults';

const log = createLogger('graph-server');

/**
 * Promisified single-attempt `httpServer.listen`. Resolves on `listening`,
 * rejects on the first `error` event. Exactly one error/listening listener
 * is attached per call so repeated invocations on the same server do not
 * leak listeners.
 *
 * Loop 02: required because `http.Server` is reusable after a failed
 * `listen` — `GraphServer.start()` retries the same instance against
 * `port`, `port+1`, ... up to 10 times on `EADDRINUSE`, and stale
 * listeners would otherwise fire on subsequent attempts.
 */
function listenOnce(server: http.Server, port: number, host: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => {
            server.removeListener('listening', onListening);
            reject(err);
        };
        const onListening = () => {
            server.removeListener('error', onError);
            resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
    });
}

/**
 * Server configuration
 */
export interface ServerConfig {
    /** Port to listen on (default: DEFAULT_PORT from config-defaults.ts). Use 0 for an ephemeral port. */
    port?: number;
    /** Workspace root directory */
    workspaceRoot: string;
    /** Artifact root (default: '.artifacts') */
    artifactRoot?: string;
    /** Auto-open browser on start (default: false) */
    openBrowser?: boolean;
    /** Enable verbose logging (default: false) */
    verbose?: boolean;
    /** Optional Bearer token required for mutating endpoints. Empty = no auth. */
    apiToken?: string;
    /**
     * Loop 21 — optional explicit override for the webview asset directory.
     * Threaded into `RegenerateDeps.assetRoot` so the launcher can skip its
     * cwd-/repo-walk discovery when the embedder already knows the path.
     */
    assetRoot?: string;
}

/**
 * Main Graph Server - orchestrates all services
 */
export class GraphServer {
    private httpServer: http.Server | null = null;
    private webSocket: WebSocketService;
    /**
     * Loop 04: watchers and the watch-manager require a `WorkspaceContext`
     * in their config. `createWorkspaceContext` is async (it realpath-
     * canonicalizes the workspace root once); we cannot build it in the
     * synchronous constructor. These four services are therefore
     * constructed in `start()` after `_ctx` is ready. Marked `!` so
     * TypeScript trusts the lifecycle invariant that `start()` runs
     * before any method that touches them.
     */
    private fileWatcher!: FileWatcherService;
    private httpHandler: HttpRequestHandler;
    private watchManager!: WatchManager;
    private archWatcher!: ArchWatcherService;
    private _ctx!: WorkspaceContext;

    private config: Required<ServerConfig>;
    private webviewDir: string;
    private isRegenerating = false;

    // Loop 20: bridge the application-layer boundary `Logger` interface
    // through the structured logger. The verbose-only gating for `info`
    // is preserved (the structured logger has its own LOG_LEVEL gate as
    // well, so this is intentionally an extra suppress for non-verbose
    // mode that historically only printed errors/warnings).
    private readonly serverLogger: BoundaryLogger = {
        info: (m) => { if (this.config.verbose) log.info(m); },
        warn: (m) => log.warn(m),
        error: (m) => log.error(m),
    };

    constructor(config: ServerConfig) {
        this.config = {
            port: config.port ?? DEFAULT_PORT,
            workspaceRoot: config.workspaceRoot,
            artifactRoot: config.artifactRoot || '.artifacts',
            openBrowser: config.openBrowser || false,
            verbose: config.verbose || false,
            apiToken: config.apiToken || '',
            // Loop 21 — empty string means "use the launcher's discovery
            // chain". `regenDeps()` translates '' → undefined before
            // forwarding so `Required<ServerConfig>` stays satisfied.
            assetRoot: config.assetRoot || '',
        };
        const { verbose } = this.config;
        this.webviewDir = path.join(this.config.workspaceRoot, this.config.artifactRoot, 'webview');

        this.webSocket = new WebSocketService(verbose);
        this.httpHandler = new HttpRequestHandler({ webviewDir: this.webviewDir, verbose });
        // L24: file watcher / arch watcher / watch manager moved to start()
        // (they need an async-constructed WorkspaceIO in their config).
    }

    /** Start the server. */
    async start(): Promise<void> {
        const { workspaceRoot, verbose } = this.config;

        // Loop 04: per-server runtime context, built once and threaded
        // to every downstream service (file watcher, arch watcher, watch
        // manager, regenerator). Replaces the per-service
        // `WorkspaceIO.create` call.
        this._ctx = await createWorkspaceContext({
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

        if (!fs.existsSync(this.webviewDir)) {
            log.info('Generating graph...');
            await this.regenerateWebview();
        }

        await this.watchManager.initialize();

        this.httpServer = http.createServer((req, res) => {
            this.httpHandler.handle(req, res);
        });
        // Loop 02: WebSocketServer attaches a permanent `error` listener on
        // the http server that re-emits as an uncaught error on the
        // WebSocketServer instance (see ws/lib/websocket-server.js
        // addListeners). With auto-port-fallback, EADDRINUSE on the first
        // bind would crash the process before the retry could run. Defer
        // WS setup until after the listen loop succeeds — connection/
        // upgrade events only matter once the http server is actually
        // listening, so the move is behavior-preserving.

        // Loop 11: replaces inline setupApiEndpoints.
        registerRoutes(this.buildContext());

        await this.fileWatcher.setup({
            onSourceChange: async (files) => await this.handleSourceChange(files),
            onEdgeListChange: async () => await this.handleEdgeListChange(),
        });

        log.info('Setting up ArchWatcher...');
        await this.archWatcher.setup((event) =>
            broadcastArchEvent(event, this.webSocket),
        );
        log.info('ArchWatcher setup complete');

        // Loop 02: auto-port-fallback. Walk startPort, startPort+1, ...,
        // up to 10 attempts on EADDRINUSE. Non-EADDRINUSE errors throw
        // immediately (no retry). After 10 failed binds, throw with the
        // full list of attempted ports. Silent fallback by default — the
        // bound port is announced once via `printServerInfo()` below.
        const startPort = this.config.port;
        const tried: number[] = [];
        let bound = false;
        for (let attempt = 0; attempt < 10 && !bound; attempt++) {
            const candidatePort = startPort + attempt;
            tried.push(candidatePort);
            try {
                await listenOnce(this.httpServer!, candidatePort, '127.0.0.1');
                this.config.port = candidatePort;
                bound = true;
            } catch (err: any) {
                if (err && err.code === 'EADDRINUSE') {
                    continue;
                }
                throw err;
            }
        }
        if (!bound) {
            throw new Error(`All ports ${tried.join(', ')} are in use.`);
        }
        // Loop 02: deferred from before the listen loop — see comment above.
        this.webSocket.setup(this.httpServer!);
        this.printServerInfo();

        if (this.config.openBrowser) {
            openBrowser(`http://127.0.0.1:${this.getPort()}`);
        }
    }

    /** Stop the server. */
    async stop(): Promise<void> {
        // L24: file watcher / arch watcher are constructed in `start()`
        // (they need an async `WorkspaceIO`). Tolerate `stop()` being
        // called before `start()` ever ran (e.g. early-aborted lifecycle).
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

    /** Build the dependency bundle that route handlers consume. */
    private buildContext(): ServerContext {
        return {
            config: this.config,
            ctx: this._ctx,
            logger: this.serverLogger,
            watchManager: this.watchManager,
            archWatcher: this.archWatcher,
            httpHandler: this.httpHandler,
            regenerateWebview: () => this.regenerateWebview(),
        };
    }

    private regenDeps(): RegenerateDeps {
        return {
            ctx: this._ctx,
            verbose: this.config.verbose,
            webSocket: this.webSocket,
            logger: this.serverLogger,
            // '' (no override) is normalized to undefined so the launcher
            // falls back to its discovery chain.
            assetRoot: this.config.assetRoot || undefined,
        };
    }

    private async regenerateWebview(): Promise<void> {
        await regenerateWebviewImpl(this.regenDeps());
    }

    private async handleSourceChange(files: string[]): Promise<void> {
        if (this.isRegenerating) return;
        this.isRegenerating = true;
        try {
            await rescanSourcesAndRegenerate(files, this.regenDeps());
        } catch (error) {
            log.error('Error regenerating edges', {
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            this.isRegenerating = false;
        }
    }

    private async handleEdgeListChange(): Promise<void> {
        if (this.isRegenerating) return;
        this.isRegenerating = true;
        try {
            await this.regenerateWebview();
        } catch (error) {
            log.error('Error regenerating webview', {
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            this.isRegenerating = false;
        }
    }

    private printServerInfo(): void {
        const watched = this.fileWatcher.getWatchedFileCount();
        log.info('LLMem Graph Server ready');
        log.info('Server running', { url: `http://127.0.0.1:${this.getPort()}` });
        log.info('Serving from', { webviewDir: this.webviewDir });
        log.info('Workspace', { workspaceRoot: this.config.workspaceRoot });
        log.info('Press Ctrl+C to stop');
        log.info('Live reload enabled', { watchedFileCount: watched });
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
