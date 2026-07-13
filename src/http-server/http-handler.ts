/**
 * HTTP Request Handler
 *
 * Handles HTTP requests for static files and API endpoints.
 *
 * Loop 11:
 *  - Adds `readRequestBody(req, opts?)` (lifted from `GraphServer`) with a
 *    1 MB default cap. Overflow throws `BodyTooLargeError`; route handlers
 *    catch it and return 413.
 *  - Adds path-traversal containment to `serveStatic`. After `path.join`,
 *    the resolved path is checked with `path.relative`; if it escapes
 *    `webviewDir`, the response is 403, not 200.
 */

import * as http from 'http';
import { createLogger } from '../common/logger';
import { LLMEM_MARKER_HEADER } from '../config-defaults';
import { serveStatic } from './http-static';

const log = createLogger('http-handler');

export interface HttpHandlerConfig {
    webviewDir: string;
    verbose?: boolean;
}

export interface ApiHandler {
    [path: string]: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;
}

/** Default request-body cap. Overrideable per call. */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024; // 1 MB

export interface ReadBodyOptions {
    /** Maximum bytes to accept. Default: {@link DEFAULT_MAX_BODY_BYTES}. */
    maxBytes?: number;
}

/**
 * Thrown by {@link readRequestBody} when the request body exceeds the cap.
 * Route handlers should catch this and return HTTP 413.
 */
export class BodyTooLargeError extends Error {
    public readonly maxBytes: number;
    public readonly receivedBytes: number;
    constructor(maxBytes: number, receivedBytes: number) {
        super(`Request body exceeded ${maxBytes} bytes (received >= ${receivedBytes})`);
        this.name = 'BodyTooLargeError';
        this.maxBytes = maxBytes;
        this.receivedBytes = receivedBytes;
    }
}

/**
 * Buffer the request body as a UTF-8 string, capped at `opts.maxBytes`
 * (default 1 MB). On overflow the promise rejects with {@link
 * BodyTooLargeError}.
 *
 * The remainder of the request stream is drained into the void (chunks
 * after the cap are discarded but the connection is left open) so the
 * caller can still send a 413 response. Tearing down the socket here
 * would race the response write and surface as ECONNRESET on the
 * client.
 *
 * Note: byte counting is on raw `Buffer.length`, not character length —
 * matches HTTP semantics. The accumulated buffer is decoded as UTF-8 at
 * the end so multi-byte sequences across chunks are handled correctly.
 */
export function readRequestBody(
    req: http.IncomingMessage,
    opts?: ReadBodyOptions,
): Promise<string> {
    const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BODY_BYTES;
    return new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let received = 0;
        let overflowed = false;

        req.on('data', (chunk: Buffer | string) => {
            const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk;
            received += buf.length;
            if (overflowed) return; // already rejected; drain remaining chunks
            if (received > maxBytes) {
                overflowed = true;
                // Drop accumulated buffer to free memory; further chunks are
                // ignored above. Reject now so the caller can write 413
                // while the request stream finishes draining.
                chunks.length = 0;
                reject(new BodyTooLargeError(maxBytes, received));
                return;
            }
            chunks.push(buf);
        });
        req.on('end', () => {
            if (overflowed) return;
            resolve(Buffer.concat(chunks).toString('utf-8'));
        });
        req.on('error', (err) => {
            if (overflowed) return;
            reject(err);
        });
    });
}

/**
 * HTTP request handler
 */
export class HttpRequestHandler {
    private config: Required<HttpHandlerConfig>;
    private apiHandlers: Map<string, ApiHandler[string]> = new Map();

    constructor(config: HttpHandlerConfig) {
        this.config = {
            webviewDir: config.webviewDir,
            verbose: config.verbose || false,
        };
    }

    /**
     * Register an API handler
     */
    registerApiHandler(path: string, handler: ApiHandler[string]): void {
        this.apiHandlers.set(path, handler);
    }

    /**
     * Handle incoming HTTP request
     */
    async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const url = req.url || '/';

        // C7: marker header on EVERY response (static, API, errors) so the
        // MCP open_window probe can verify the listener is llmem before
        // handing its URL to an agent.
        res.setHeader(LLMEM_MARKER_HEADER, '1');

        if (this.config.verbose) {
            log.debug('Request', { method: req.method, url });
        }

        // API endpoints
        if (url.startsWith('/api/')) {
            const handler = this.apiHandlers.get(url.split('?')[0]);
            if (handler) {
                try {
                    await handler(req, res);
                } catch (error) {
                    this.sendError(res, 500, String(error));
                }
                return;
            }
        }

        // Serve static files. Containment + content-type + cache policy live
        // in the sibling `http-static` module; `sendError` is threaded in so
        // error responses keep going through this handler's single path.
        serveStatic(this.config.webviewDir, url, res, this.sendError.bind(this));
    }

    /**
     * Send JSON response
     */
    sendJson(res: http.ServerResponse, statusCode: number, data: any): void {
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data, null, 2));
    }

    /**
     * Send error response
     */
    sendError(res: http.ServerResponse, statusCode: number, message: string): void {
        res.writeHead(statusCode, { 'Content-Type': 'text/plain' });
        res.end(message);
    }
}
