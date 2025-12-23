/**
 * HTTP Request Handler
 *
 * Handles HTTP requests for static files and API endpoints.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

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
            console.log(`${req.method} ${url}`);
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
     * Serve static files from webview directory
     */
    private serveStatic(url: string, res: http.ServerResponse): void {
        // Default to index.html for root
        let filePath = url === '/' ? '/index.html' : url;

        // Remove query string
        filePath = filePath.split('?')[0];

        // Security: prevent directory traversal
        filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');

        const fullPath = path.join(this.config.webviewDir, filePath);

        // Check if file exists
        if (!fs.existsSync(fullPath)) {
            this.sendError(res, 404, '404 Not Found');
            return;
        }

        // Check if it's a file (not a directory)
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) {
            this.sendError(res, 403, '403 Forbidden');
            return;
        }

        // Determine MIME type
        const ext = path.extname(fullPath).toLowerCase();
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
        fs.readFile(fullPath, (error, content) => {
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
