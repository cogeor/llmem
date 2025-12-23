/**
 * LLMem Graph Server
 *
 * HTTP server with WebSocket live reload and file watching.
 * Clean, modular architecture with separated concerns.
 */

import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { generateGraph, getGraphStats } from '../web-launcher';
import { WebSocketService } from './websocket';
import { FileWatcherService } from './file-watcher';
import { HttpRequestHandler } from './http-handler';
import { WatchManager } from './watch-manager';

/**
 * Server configuration
 */
export interface ServerConfig {
    /** Port to listen on (default: 3000) */
    port?: number;
    /** Workspace root directory */
    workspaceRoot: string;
    /** Artifact root (default: '.artifacts') */
    artifactRoot?: string;
    /** Auto-open browser on start (default: false) */
    openBrowser?: boolean;
    /** Enable verbose logging (default: false) */
    verbose?: boolean;
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

    private config: Required<ServerConfig>;
    private webviewDir: string;
    private isRegenerating = false;

    constructor(config: ServerConfig) {
        this.config = {
            port: config.port || 3000,
            workspaceRoot: config.workspaceRoot,
            artifactRoot: config.artifactRoot || '.artifacts',
            openBrowser: config.openBrowser || false,
            verbose: config.verbose || false,
        };

        this.webviewDir = path.join(
            this.config.workspaceRoot,
            this.config.artifactRoot,
            'webview'
        );

        // Initialize services
        this.webSocket = new WebSocketService(this.config.verbose);
        this.fileWatcher = new FileWatcherService({
            workspaceRoot: this.config.workspaceRoot,
            artifactRoot: this.config.artifactRoot,
            verbose: this.config.verbose,
        });
        this.httpHandler = new HttpRequestHandler({
            webviewDir: this.webviewDir,
            verbose: this.config.verbose,
        });
        this.watchManager = new WatchManager({
            workspaceRoot: this.config.workspaceRoot,
            artifactRoot: this.config.artifactRoot,
            verbose: this.config.verbose,
        });
    }

    /**
     * Start the server
     */
    async start(): Promise<void> {
        // Generate graph if not already done
        if (!fs.existsSync(this.webviewDir)) {
            console.log('Generating graph...');
            await this.generateGraph();
        }

        // Initialize watch manager
        await this.watchManager.initialize();

        // Create HTTP server
        this.httpServer = http.createServer((req, res) => {
            this.httpHandler.handle(req, res);
        });

        // Setup WebSocket
        this.webSocket.setup(this.httpServer);

        // Setup API endpoints
        this.setupApiEndpoints();

        // Setup file watching
        await this.fileWatcher.setup({
            onSourceChange: async (files) => await this.handleSourceChange(files),
            onEdgeListChange: async () => await this.handleEdgeListChange(),
            onArchChange: async () => await this.handleArchChange(),
        });

        // Start listening
        await new Promise<void>((resolve, reject) => {
            this.httpServer!.listen(this.config.port, () => {
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

        // Open browser if requested
        if (this.config.openBrowser) {
            this.openBrowser();
        }
    }

    /**
     * Stop the server
     */
    async stop(): Promise<void> {
        await this.fileWatcher.close();
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

    /**
     * Setup API endpoints
     */
    private setupApiEndpoints(): void {
        // GET /api/stats - Graph statistics
        this.httpHandler.registerApiHandler('/api/stats', async (req, res) => {
            const stats = await getGraphStats(
                this.config.workspaceRoot,
                this.config.artifactRoot
            );
            this.httpHandler.sendJson(res, 200, stats);
        });

        // POST /api/regenerate - Force regenerate graph
        this.httpHandler.registerApiHandler('/api/regenerate', async (req, res) => {
            await this.regenerateWebview();
            this.httpHandler.sendJson(res, 200, {
                success: true,
                message: 'Graph regenerated'
            });
        });

        // GET /api/watched - Get watched files
        this.httpHandler.registerApiHandler('/api/watched', async (req, res) => {
            const state = this.watchManager.getWatchState();
            this.httpHandler.sendJson(res, 200, state);
        });

        // /api/watch - Add/Remove watched files (POST/DELETE)
        this.httpHandler.registerApiHandler('/api/watch', async (req, res) => {
            const body = await this.readRequestBody(req);
            const { path: relativePath } = JSON.parse(body);

            if (!relativePath) {
                this.httpHandler.sendJson(res, 400, {
                    success: false,
                    message: 'Missing "path" parameter'
                });
                return;
            }

            // Route based on HTTP method
            if (req.method === 'POST') {
                // Add to watched
                const result = await this.watchManager.addToWatch(relativePath);

                if (result.success) {
                    // Regenerate edges for newly watched files
                    const artifactDir = path.join(this.config.workspaceRoot, this.config.artifactRoot);
                    const { generateCallEdgesForFile } = await import('../../scripts/generate-call-edges');

                    for (const file of result.addedFiles) {
                        await generateCallEdgesForFile(this.config.workspaceRoot, file, artifactDir);
                    }

                    await this.regenerateWebview();
                }

                this.httpHandler.sendJson(res, result.success ? 200 : 400, result);
            } else if (req.method === 'DELETE') {
                // Remove from watched
                const result = await this.watchManager.removeFromWatch(relativePath);

                if (result.success) {
                    // Delete edges for unwatched files
                    const artifactDir = path.join(this.config.workspaceRoot, this.config.artifactRoot);
                    const { ImportEdgeListStore, CallEdgeListStore } = await import('../../graph/edgelist');

                    const importStore = new ImportEdgeListStore(artifactDir);
                    await importStore.load();
                    importStore.removeByFolder(relativePath);
                    await importStore.save();

                    const callStore = new CallEdgeListStore(artifactDir);
                    await callStore.load();
                    callStore.removeByFolder(relativePath);
                    await callStore.save();

                    await this.regenerateWebview();
                }

                this.httpHandler.sendJson(res, result.success ? 200 : 400, result);
            } else {
                this.httpHandler.sendJson(res, 405, {
                    success: false,
                    message: `Method ${req.method} not allowed`
                });
            }
        });
    }

    /**
     * Handle source file changes
     */
    private async handleSourceChange(files: string[]): Promise<void> {
        if (this.isRegenerating) return;

        this.isRegenerating = true;
        try {
            console.log(`🔄 Regenerating edges for ${files.length} changed file(s)...`);

            const artifactDir = path.join(this.config.workspaceRoot, this.config.artifactRoot);
            const { generateCallEdgesForFile } = await import('../../scripts/generate-call-edges');

            for (const file of files) {
                await generateCallEdgesForFile(this.config.workspaceRoot, file, artifactDir);
            }

            console.log('✓ Edges regenerated');
            await this.regenerateWebview();
        } catch (error) {
            console.error('Error regenerating edges:', error);
        } finally {
            this.isRegenerating = false;
        }
    }

    /**
     * Handle edge list changes
     */
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

    /**
     * Handle .arch directory changes
     */
    private async handleArchChange(): Promise<void> {
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

    /**
     * Regenerate webview and notify clients
     */
    private async regenerateWebview(): Promise<void> {
        console.log('🔄 Regenerating webview...');
        await this.generateGraph();
        console.log('✓ Webview updated');

        this.webSocket.broadcast({
            type: 'reload',
            message: 'Graph updated, reloading...'
        });
    }

    /**
     * Generate graph
     */
    private async generateGraph(): Promise<void> {
        const result = await generateGraph({
            workspaceRoot: this.config.workspaceRoot,
            artifactRoot: this.config.artifactRoot,
            graphOnly: false,
        });

        if (this.config.verbose) {
            console.log('Graph generated:');
            console.log(`  Import: ${result.importNodeCount} nodes, ${result.importEdgeCount} edges`);
            console.log(`  Call: ${result.callNodeCount} nodes, ${result.callEdgeCount} edges`);
        }
    }

    /**
     * Read request body
     */
    private async readRequestBody(req: http.IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => resolve(body));
            req.on('error', reject);
        });
    }

    /**
     * Open browser
     */
    private openBrowser(): void {
        const { exec } = require('child_process');
        const url = `http://localhost:${this.config.port}`;
        const command =
            process.platform === 'win32' ? 'start' :
            process.platform === 'darwin' ? 'open' :
            'xdg-open';

        exec(`${command} "${url}"`, (error: any) => {
            if (error) {
                console.error(`Failed to open browser: ${error.message}`);
                console.log(`Please open ${url} manually.`);
            }
        });
    }

    /**
     * Print server info
     */
    private printServerInfo(): void {
        console.log('');
        console.log('┌─────────────────────────────────────────┐');
        console.log('│  LLMem Graph Server                     │');
        console.log('└─────────────────────────────────────────┘');
        console.log('');
        console.log(`  🌐 Server running at: http://localhost:${this.config.port}`);
        console.log(`  📁 Serving from: ${this.webviewDir}`);
        console.log(`  📊 Workspace: ${this.config.workspaceRoot}`);
        console.log('');
        console.log('  Press Ctrl+C to stop');
        console.log('');
        console.log(`  🔄 Live reload enabled`);
        console.log(`  👁️  Watching ${this.fileWatcher.getWatchedFileCount()} files`);
        console.log('');
    }
}

/**
 * Start server with default configuration
 */
export async function startServer(
    workspaceRoot: string,
    port: number = 3000
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
