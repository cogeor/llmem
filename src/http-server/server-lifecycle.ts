/**
 * GraphServer lifecycle helpers.
 *
 * B8: extracted from `index.ts` so the `GraphServer` class shell stays
 * under the 250-line platform-handler budget. These are the stateless
 * pieces of the start/stop sequence — the HTTP listen + port-fallback
 * walk and the cold-start workspace scan — lifted verbatim as free
 * functions the class composes. The class keeps everything that needs
 * `this` (service references, the `isRegenerating` latch, public methods).
 */

import * as http from 'http';
import { hasEdgeLists } from '../viewer-generator';
import { scanFolderRecursive } from '../application/scan';
import { createLogger } from '../common/logger';
import type { WorkspaceContext } from '../application/workspace-context';

const log = createLogger('graph-server');

/**
 * Promisified single-attempt `httpServer.listen`. Resolves on `listening`,
 * rejects on the first `error` event. Exactly one error/listening listener
 * is attached per call so repeated invocations on the same server do not
 * leak listeners.
 *
 * Loop 02: required because `http.Server` is reusable after a failed
 * `listen` — `GraphServer.start()` retries the same instance against
 * `port`, `port+1`, ... up to 10 times on `EADDRINUSE`, and stale
 * listeners would otherwise fire on subsequent attempts.
 */
export function listenOnce(server: http.Server, port: number, host: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => {
            server.removeListener('listening', onListening);
            reject(err);
        };
        const onListening = () => {
            server.removeListener('error', onError);
            resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
    });
}

/**
 * Auto-port-fallback bind. Walk `startPort`, `startPort+1`, ..., up to 10
 * attempts on EADDRINUSE. Non-EADDRINUSE errors throw immediately (no
 * retry). After 10 failed binds, throw with the full list of attempted
 * ports. Returns the port the server actually bound to.
 *
 * Loop 02: silent fallback by default — the bound port is announced once
 * by the caller via `printServerInfo()`.
 */
export async function bindWithPortFallback(
    server: http.Server,
    startPort: number,
): Promise<number> {
    const tried: number[] = [];
    for (let attempt = 0; attempt < 10; attempt++) {
        const candidatePort = startPort + attempt;
        tried.push(candidatePort);
        try {
            await listenOnce(server, candidatePort, '127.0.0.1');
            return candidatePort;
        } catch (err: any) {
            if (err && err.code === 'EADDRINUSE') {
                continue;
            }
            throw err;
        }
    }
    throw new Error(`All ports ${tried.join(', ')} are in use.`);
}

/**
 * Cold-start scan guard.
 *
 * A fresh workspace has no edge lists yet. Mirror `llmem serve`
 * (cli/commands/serve.ts) and scan once before regenerating the webview,
 * so a bare `new GraphServer().start()` indexes instead of throwing "Edge
 * lists not found". Guarded by `hasEdgeLists` so a warm workspace (edge
 * lists already present) is untouched — no perf hit.
 */
export async function coldStartScan(
    ctx: WorkspaceContext,
    workspaceRoot: string,
    artifactRoot: string,
): Promise<void> {
    if (!hasEdgeLists(workspaceRoot, artifactRoot)) {
        log.info('Indexing workspace... (first run)');
        await scanFolderRecursive(ctx, { folderPath: '.' });
    }
}

/** Banner the class prints once after the server binds. */
export interface ServerInfo {
    watchedFileCount: number;
    url: string;
    webviewDir: string;
    workspaceRoot: string;
}

/** Emit the ready banner. Pure logging — reads no server state directly. */
export function printServerInfo(info: ServerInfo): void {
    log.info('LLMem Graph Server ready');
    log.info('Server running', { url: info.url });
    log.info('Serving from', { webviewDir: info.webviewDir });
    log.info('Workspace', { workspaceRoot: info.workspaceRoot });
    log.info('Press Ctrl+C to stop');
    log.info('Live reload enabled', { watchedFileCount: info.watchedFileCount });
}
