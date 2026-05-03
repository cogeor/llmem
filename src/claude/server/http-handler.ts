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
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../../common/logger';

const log = createLogger('http-handler');

/**
 * MIME types for common file extensions
 */
const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.map': 'application/json',
};

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

        // Serve static files
        this.serveStatic(url, res);
    }

    /**
     * Serve static files from webview directory.
     *
     * Containment: after `path.join(webviewDir, filePath)`, the result MUST
     * be inside `webviewDir`. `path.normalize` alone does NOT guarantee this
     * (it strips a leading `..` but `foo/../../etc/passwd` still escapes
     * after the join). The post-join `path.relative` check is the actual
     * defense — see Loop 11 plan task 11.2.
     */
    private serveStatic(url: string, res: http.ServerResponse): void {
        // Default to index.html for root
        let filePath = url === '/' ? '/index.html' : url;

        // Remove query string
        filePath = filePath.split('?')[0];

        // Best-effort pre-clean: strip leading parent traversals before the join.
        filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');

        const fullPath = path.join(this.config.webviewDir, filePath);

        // Strict containment: the resolved path must stay under webviewDir.
        // path.relative returns '..' or an absolute path when fullPath escapes.
        const baseDir = path.resolve(this.config.webviewDir);
        const resolvedFull = path.resolve(fullPath);
        const rel = path.relative(baseDir, resolvedFull);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            this.sendError(res, 403, '403 Forbidden');
            return;
        }

        // Check if file exists
        if (!fs.existsSync(resolvedFull)) {
            this.sendError(res, 404, '404 Not Found');
            return;
        }

        // Check if it's a file (not a directory)
        const stat = fs.statSync(resolvedFull);
        if (!stat.isFile()) {
            this.sendError(res, 403, '403 Forbidden');
            return;
        }

        // Determine MIME type
        const ext = path.extname(resolvedFull).toLowerCase();
        const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

        // Determine cache headers
        // Disable caching for .js and .json files (graph data may change)
        // Allow caching for static assets (CSS, images)
        const headers: Record<string, string> = {
            'Content-Type': mimeType
        };

        if (ext === '.js' || ext === '.json') {
            // No caching for JavaScript and JSON - always fetch latest
            headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
            headers['Pragma'] = 'no-cache';
            headers['Expires'] = '0';
        } else {
            // Allow short caching for other static assets
            headers['Cache-Control'] = 'public, max-age=300'; // 5 minutes
        }

        // Read and serve file
        fs.readFile(resolvedFull, (error, content) => {
            if (error) {
                this.sendError(res, 500, '500 Internal Server Error');
                return;
            }

            res.writeHead(200, headers);
            res.end(content);
        });
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
