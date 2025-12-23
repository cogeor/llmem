/**
 * WebSocket Server for Live Reload
 *
 * Manages WebSocket connections and broadcasts reload events to clients.
 */

import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';

export interface WebSocketMessage {
    type: string;
    message?: string;
    data?: any;
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
}
