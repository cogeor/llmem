/**
 * WebSocket Server for Live Reload and Incremental Updates
 *
 * Manages WebSocket connections and broadcasts events to clients.
 *
 * Message Types:
 * - 'reload': Full page reload (legacy, for major changes)
 * - 'arch:created': New design doc created
 * - 'arch:updated': Design doc content changed
 * - 'arch:deleted': Design doc removed
 * - 'graph:updated': Graph data changed (triggers graph re-fetch)
 */

import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';

/**
 * WebSocket message types
 */
export type WebSocketMessageType =
    | 'reload'
    | 'arch:created'
    | 'arch:updated'
    | 'arch:deleted'
    | 'graph:updated';

/**
 * Base message structure
 */
export interface WebSocketMessage {
    type: WebSocketMessageType | string;
    message?: string;
    data?: any;
}

/**
 * Arch file event message
 */
export interface ArchEventMessage extends WebSocketMessage {
    type: 'arch:created' | 'arch:updated' | 'arch:deleted';
    data: {
        /** Relative path from .arch, e.g. "src/parser.md" */
        path: string;
        /** Markdown content (for created/updated) */
        markdown?: string;
        /** Rendered HTML (for created/updated) */
        html?: string;
    };
}

/**
 * Graph update message
 */
export interface GraphUpdateMessage extends WebSocketMessage {
    type: 'graph:updated';
    data?: {
        /** Optional: include updated graph data inline */
        importGraph?: any;
        callGraph?: any;
    };
}

/**
 * WebSocket service for live reload
 */
export class WebSocketService {
    private wsServer: WebSocketServer | null = null;
    private clients: Set<WebSocket> = new Set();
    private verbose: boolean;

    constructor(verbose = false) {
        this.verbose = verbose;
    }

    /**
     * Setup WebSocket server
     */
    setup(httpServer: http.Server): void {
        this.wsServer = new WebSocketServer({ server: httpServer });

        this.wsServer.on('connection', (ws: WebSocket) => {
            this.clients.add(ws);

            if (this.verbose) {
                console.log(`[WebSocket] Client connected (${this.clients.size} total)`);
            }

            ws.on('close', () => {
                this.clients.delete(ws);
                if (this.verbose) {
                    console.log(`[WebSocket] Client disconnected (${this.clients.size} remaining)`);
                }
            });

            ws.on('error', (error) => {
                if (this.verbose) {
                    console.error('[WebSocket] Client error:', error);
                }
            });
        });
    }

    /**
     * Broadcast message to all connected clients
     */
    broadcast(message: WebSocketMessage): void {
        const data = JSON.stringify(message);
        let sent = 0;

        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(data);
                sent++;
            }
        }

        if (this.verbose && sent > 0) {
            console.log(`[WebSocket] Broadcasted to ${sent} client(s):`, message.type);
        }
    }

    /**
     * Close all connections and shutdown server
     */
    async close(): Promise<void> {
        // Close all client connections
        for (const client of this.clients) {
            client.close();
        }
        this.clients.clear();

        // Close WebSocket server
        if (this.wsServer) {
            await new Promise<void>((resolve) => {
                this.wsServer!.close(() => {
                    resolve();
                });
            });
            this.wsServer = null;
        }
    }

    /**
     * Get number of connected clients
     */
    getClientCount(): number {
        return this.clients.size;
    }

    /**
     * Broadcast arch file event
     */
    broadcastArchEvent(
        type: 'arch:created' | 'arch:updated' | 'arch:deleted',
        path: string,
        markdown?: string,
        html?: string
    ): void {
        const message: ArchEventMessage = {
            type,
            data: { path, markdown, html }
        };
        this.broadcast(message);
    }

    /**
     * Broadcast graph update event
     */
    broadcastGraphUpdate(): void {
        const message: GraphUpdateMessage = {
            type: 'graph:updated',
            message: 'Graph data has been updated'
        };
        this.broadcast(message);
    }

    /**
     * Broadcast full reload event (legacy)
     */
    broadcastReload(reason?: string): void {
        this.broadcast({
            type: 'reload',
            message: reason || 'Reloading...'
        });
    }
}
