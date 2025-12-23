/**
 * WebSocket Live Reload Client
 *
 * Connects to the HTTP server's WebSocket endpoint and reloads
 * the page when the graph is updated.
 */

export class LiveReloadClient {
    private ws: WebSocket | null = null;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 10;
    private reconnectDelay = 1000;
    private isConnecting = false;

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

        switch (message.type) {
            case 'reload':
                console.log('[LiveReload] Graph updated, reloading page...');
                // Give a brief moment for the message to be logged
                setTimeout(() => {
                    window.location.reload();
                }, 100);
                break;

            default:
                if (this.verbose) {
                    console.log('[LiveReload] Unknown message type:', message.type);
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

// Auto-connect on page load
const liveReload = new LiveReloadClient();
liveReload.connect();
