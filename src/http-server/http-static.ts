/**
 * HTTP static-file serving
 *
 * Free-function static-file server split out of `HttpRequestHandler` to keep
 * the handler class shell under the platform line budget. Path-containment,
 * content-type resolution, and cache-header policy all live here.
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

/** `sendError(res, statusCode, message)` — threaded in from the handler. */
export type SendError = (res: http.ServerResponse, statusCode: number, message: string) => void;

/**
 * Serve static files from `webviewDir`.
 *
 * Containment: after `path.join(webviewDir, filePath)`, the result MUST
 * be inside `webviewDir`. `path.normalize` alone does NOT guarantee this
 * (it strips a leading `..` but `foo/../../etc/passwd` still escapes
 * after the join). The post-join `path.relative` check is the actual
 * defense — see Loop 11 plan task 11.2.
 *
 * `sendError` is threaded in so error responses keep going through the
 * handler's single error path.
 */
export function serveStatic(
    webviewDir: string,
    url: string,
    res: http.ServerResponse,
    sendError: SendError,
): void {
    // Default to index.html for root
    let filePath = url === '/' ? '/index.html' : url;

    // Remove query string
    filePath = filePath.split('?')[0];

    // Best-effort pre-clean: strip leading parent traversals before the join.
    filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');

    const fullPath = path.join(webviewDir, filePath);

    // Strict containment: the resolved path must stay under webviewDir.
    // path.relative returns '..' or an absolute path when fullPath escapes.
    const baseDir = path.resolve(webviewDir);
    const resolvedFull = path.resolve(fullPath);
    const rel = path.relative(baseDir, resolvedFull);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        sendError(res, 403, '403 Forbidden');
        return;
    }

    // Check if file exists
    if (!fs.existsSync(resolvedFull)) {
        sendError(res, 404, '404 Not Found');
        return;
    }

    // Check if it's a file (not a directory)
    const stat = fs.statSync(resolvedFull);
    if (!stat.isFile()) {
        sendError(res, 403, '403 Forbidden');
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
            sendError(res, 500, '500 Internal Server Error');
            return;
        }

        res.writeHead(200, headers);
        res.end(content);
    });
}
