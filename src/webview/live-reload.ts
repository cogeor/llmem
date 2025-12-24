/**
 * WebSocket Client for Live Updates
 *
 * Connects to the HTTP server's WebSocket endpoint and handles:
 * - 'reload': Full page reload (legacy)
 * - 'arch:created': New design doc created
 * - 'arch:updated': Design doc content changed
 * - 'arch:deleted': Design doc removed
 * - 'graph:updated': Graph data changed
 */

export type WebSocketEventType =
    | 'reload'
    | 'arch:created'
    | 'arch:updated'
    | 'arch:deleted'
    | 'graph:updated';

export interface ArchEventData {
    path: string;
    markdown?: string;
    html?: string;
}

export interface WebSocketEventData {
    type: WebSocketEventType;
    data?: ArchEventData | any;
    message?: string;
}

type EventCallback = (data: WebSocketEventData) => void;

export class LiveReloadClient {
    private ws: WebSocket | null = null;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 10;
    private reconnectDelay = 1000;
    private isConnecting = false;
    private eventListeners: Map<WebSocketEventType | 'all', Set<EventCallback>> = new Map();

    constructor(private verbose = false) {}

    /**
     * Connect to WebSocket server
     */
    connect(): void {
        // Only connect if we're in HTTP mode (not VSCode)
        const isVscode = !!(window as any).acquireVsCodeApi;
        if (isVscode) {
            if (this.verbose) {
                console.log('[LiveReload] Skipping WebSocket in VSCode mode');
            }
            return;
        }

        // Don't connect if already connecting or connected
        if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
            return;
        }

        this.isConnecting = true;

        try {
            // Connect to WebSocket on same host/port
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}`;

            if (this.verbose) {
                console.log(`[LiveReload] Connecting to ${wsUrl}...`);
            }

            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('[LiveReload] Connected');
                this.reconnectAttempts = 0;
                this.isConnecting = false;
            };

            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleMessage(message);
                } catch (error) {
                    console.error('[LiveReload] Error parsing message:', error);
                }
            };

            this.ws.onerror = (error) => {
                console.error('[LiveReload] WebSocket error:', error);
                this.isConnecting = false;
            };

            this.ws.onclose = () => {
                console.log('[LiveReload] Disconnected');
                this.ws = null;
                this.isConnecting = false;
                this.attemptReconnect();
            };
        } catch (error) {
            console.error('[LiveReload] Failed to create WebSocket:', error);
            this.isConnecting = false;
            this.attemptReconnect();
        }
    }

    /**
     * Handle WebSocket message
     */
    private handleMessage(message: any): void {
        if (this.verbose) {
            console.log('[LiveReload] Message:', message);
        }

        const eventData: WebSocketEventData = {
            type: message.type,
            data: message.data,
            message: message.message
        };

        // Emit to specific listeners
        this.emit(message.type, eventData);

        // Emit to 'all' listeners
        this.emit('all', eventData);

        // Handle default behaviors
        switch (message.type) {
            case 'reload':
                console.log('[LiveReload] Full reload requested...');
                // Give a brief moment for the message to be logged
                setTimeout(() => {
                    window.location.reload();
                }, 100);
                break;

            case 'arch:created':
            case 'arch:updated':
            case 'arch:deleted':
                console.log(`[LiveReload] Arch ${message.type.split(':')[1]}: ${message.data?.path}`);
                // Handled by event listeners - no default action
                break;

            case 'graph:updated':
                console.log('[LiveReload] Graph updated');
                // Handled by event listeners - no default action
                break;

            default:
                if (this.verbose) {
                    console.log('[LiveReload] Unknown message type:', message.type);
                }
        }
    }

    /**
     * Subscribe to a specific event type
     * @param type Event type or 'all' for all events
     * @param callback Callback function
     * @returns Unsubscribe function
     */
    on(type: WebSocketEventType | 'all', callback: EventCallback): () => void {
        if (!this.eventListeners.has(type)) {
            this.eventListeners.set(type, new Set());
        }
        this.eventListeners.get(type)!.add(callback);

        return () => {
            this.eventListeners.get(type)?.delete(callback);
        };
    }

    /**
     * Emit event to listeners
     */
    private emit(type: WebSocketEventType | 'all', data: WebSocketEventData): void {
        const listeners = this.eventListeners.get(type);
        if (listeners) {
            for (const callback of listeners) {
                try {
                    callback(data);
                } catch (e) {
                    console.error(`[LiveReload] Error in event listener:`, e);
                }
            }
        }
    }

    /**
     * Attempt to reconnect after a delay
     */
    private attemptReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[LiveReload] Max reconnection attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5);

        if (this.verbose) {
            console.log(`[LiveReload] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        }

        setTimeout(() => {
            this.connect();
        }, delay);
    }

    /**
     * Disconnect from WebSocket
     */
    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

// Singleton instance - auto-connects on page load
export const liveReloadClient = new LiveReloadClient();
liveReloadClient.connect();
