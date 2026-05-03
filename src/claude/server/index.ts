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
import type { Logger } from '../../core/logger';
import { registerRoutes } from './routes';
import type { ServerContext } from './routes';
import { openBrowser } from './open-browser';
import {
    broadcastArchEvent,
    regenerateWebview as regenerateWebviewImpl,
    rescanSourcesAndRegenerate,
    type RegenerateDeps,
} from './regenerator';

/**
 * Server configuration
 */
export interface ServerConfig {
    /** Port to listen on (default: 3000). Use 0 for an ephemeral port. */
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
}

/**
 * Main Graph Server - orchestrates all services
 */
export class GraphServer {
    private httpServer: http.Server | null = null;
    private webSocket: WebSocketService;
    private fileWatcher: FileWatcherService;
    private httpHandler: HttpRequestHandler;
    private watchManager: WatchManager;
    private archWatcher: ArchWatcherService;

    private config: Required<ServerConfig>;
    private webviewDir: string;
    private isRegenerating = false;

    private readonly serverLogger: Logger = {
        info: (m) => { if (this.config.verbose) console.log(m); },
        warn: (m) => console.warn(m),
        error: (m) => console.error(m),
    };

    constructor(config: ServerConfig) {
        this.config = {
            port: config.port ?? 3000,
            workspaceRoot: config.workspaceRoot,
            artifactRoot: config.artifactRoot || '.artifacts',
            openBrowser: config.openBrowser || false,
            verbose: config.verbose || false,
            apiToken: config.apiToken || '',
        };
        const { workspaceRoot, artifactRoot, verbose } = this.config;
        this.webviewDir = path.join(workspaceRoot, artifactRoot, 'webview');

        this.webSocket = new WebSocketService(verbose);
        this.fileWatcher = new FileWatcherService({ workspaceRoot, artifactRoot, verbose });
        this.httpHandler = new HttpRequestHandler({ webviewDir: this.webviewDir, verbose });
        this.watchManager = new WatchManager({ workspaceRoot, artifactRoot, verbose });
        this.archWatcher = new ArchWatcherService({ workspaceRoot, verbose });
    }

    /** Start the server. */
    async start(): Promise<void> {
        if (!fs.existsSync(this.webviewDir)) {
            console.log('Generating graph...');
            await this.regenerateWebview();
        }

        await this.watchManager.initialize();

        this.httpServer = http.createServer((req, res) => {
            this.httpHandler.handle(req, res);
        });
        this.webSocket.setup(this.httpServer);

        // Loop 11: replaces inline setupApiEndpoints.
        registerRoutes(this.buildContext());

        await this.fileWatcher.setup({
            onSourceChange: async (files) => await this.handleSourceChange(files),
            onEdgeListChange: async () => await this.handleEdgeListChange(),
        });

        console.log('[GraphServer] Setting up ArchWatcher...');
        await this.archWatcher.setup((event) =>
            broadcastArchEvent(event, this.webSocket),
        );
        console.log('[GraphServer] ArchWatcher setup complete');

        await new Promise<void>((resolve, reject) => {
            this.httpServer!.listen(this.config.port, '127.0.0.1', () => {
                this.printServerInfo();
                resolve();
            });
            this.httpServer!.on('error', (error: any) => {
                if (error.code === 'EADDRINUSE') {
                    console.error(`Error: Port ${this.config.port} is already in use.`);
                    console.error(`Try a different port with --port <number>`);
                } else {
                    console.error('Server error:', error);
                }
                reject(error);
            });
        });

        if (this.config.openBrowser) {
            openBrowser(`http://127.0.0.1:${this.getPort()}`);
        }
    }

    /** Stop the server. */
    async stop(): Promise<void> {
        await this.fileWatcher.close();
        await this.archWatcher.close();
        await this.webSocket.close();
        if (this.httpServer) {
            await new Promise<void>((resolve) => {
                this.httpServer!.close(() => {
                    console.log('Server stopped');
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
            logger: this.serverLogger,
            watchManager: this.watchManager,
            archWatcher: this.archWatcher,
            httpHandler: this.httpHandler,
            regenerateWebview: () => this.regenerateWebview(),
        };
    }

    private regenDeps(): RegenerateDeps {
        return {
            workspaceRoot: this.config.workspaceRoot,
            artifactRoot: this.config.artifactRoot,
            verbose: this.config.verbose,
            webSocket: this.webSocket,
            logger: this.serverLogger,
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
            console.error('Error regenerating edges:', error);
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
            console.error('Error regenerating webview:', error);
        } finally {
            this.isRegenerating = false;
        }
    }

    private printServerInfo(): void {
        const watched = this.fileWatcher.getWatchedFileCount();
        console.log('\nLLMem Graph Server\n');
        console.log(`  Server running at: http://127.0.0.1:${this.getPort()}`);
        console.log(`  Serving from: ${this.webviewDir}`);
        console.log(`  Workspace: ${this.config.workspaceRoot}\n`);
        console.log(`  Press Ctrl+C to stop\n`);
        console.log(`  Live reload enabled — watching ${watched} files\n`);
    }
}

/**
 * Start server with default configuration
 */
export async function startServer(
    workspaceRoot: string,
    port: number = 3000,
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
