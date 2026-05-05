/**
 * Webview regeneration + source-change handling.
 *
 * Loop 11 lifted these helpers out of `GraphServer` so `index.ts` only
 * holds the lifecycle wiring. The class still owns the `isRegenerating`
 * latch and websocket service references; this module exposes pure-ish
 * functions the class composes.
 *
 * Loop 04: `RegenerateDeps` carries a `WorkspaceContext` rather than a
 * parallel `(workspaceRoot, artifactRoot, io)` triple. The launcher
 * (`generateGraph`) takes the same context.
 */

import { generateGraph as generateGraphLauncher } from '../web-launcher';
import { scanFile } from '../../application/scan';
import type { Logger } from '../../core/logger';
import type { WebSocketService } from './websocket';
import type { ArchFileEvent } from './arch-watcher';
import { createLogger } from '../../common/logger';
import type { WorkspaceContext } from '../../application/workspace-context';

const log = createLogger('regenerator');

export interface RegenerateDeps {
    /**
     * Loop 04 — per-server `WorkspaceContext`, constructed once at server
     * start in `GraphServer.start()` and threaded through every per-call
     * `regenDeps()` payload.
     */
    ctx: WorkspaceContext;
    verbose: boolean;
    webSocket: WebSocketService;
    logger: Logger;
    /**
     * Loop 21 — optional explicit override for the webview asset directory,
     * threaded through from `ServerConfig.assetRoot`. When omitted, the
     * launcher's discovery chain runs.
     */
    assetRoot?: string;
}

/**
 * Regenerate the static webview and broadcast a websocket reload.
 */
export async function regenerateWebview(deps: RegenerateDeps): Promise<void> {
    log.info('Regenerating webview...');
    // Loop 11 followup — `generateGraph` itself now emits folder-tree +
    // folder-edges artifacts. We pass the context through so the launcher
    // reuses our long-lived `WorkspaceIO` (avoids a redundant realpath
    // canonicalization on every file-watcher tick). An aggregator failure
    // throws out of `generateGraphLauncher`, aborting before the websocket
    // broadcast — same fail-loud posture as the previous explicit call.
    const result = await generateGraphLauncher({
        ctx: deps.ctx,
        graphOnly: false,
        assetRoot: deps.assetRoot,
    });

    if (deps.verbose) {
        log.info('Graph generated', {
            importNodes: result.importNodeCount,
            importEdges: result.importEdgeCount,
            callNodes: result.callNodeCount,
            callEdges: result.callEdgeCount,
        });
    }

    log.info('Webview updated');

    deps.webSocket.broadcast({
        type: 'reload',
        message: 'Graph updated, reloading...',
    });
}

/**
 * Run `scanFile` on every changed source path, then regenerate the webview.
 */
export async function rescanSourcesAndRegenerate(
    files: string[],
    deps: RegenerateDeps,
): Promise<void> {
    log.info('Regenerating edges for changed files', { count: files.length });

    for (const file of files) {
        await scanFile(deps.ctx, { filePath: file });
    }

    log.info('Edges regenerated');
    // Loop 11 followup: folder-artifact emission lives inside `generateGraph`,
    // which `regenerateWebview` invokes below. Every code path that writes
    // import-edgelist.json / call-edgelist.json must end with a
    // regenerateWebview() call to keep the folder artifacts in sync. Do
    // NOT add a buildAndSaveFolderArtifacts call here — the delegation
    // chain (regenerateWebview → generateGraph) already covers it.
    await regenerateWebview(deps);
}

/**
 * Translate an ArchWatcher event into a websocket broadcast.
 */
export function broadcastArchEvent(
    event: ArchFileEvent,
    webSocket: WebSocketService,
): void {
    log.debug('Arch event', { type: event.type, relativePath: event.relativePath });

    const wsType =
        `arch:${event.type}` as 'arch:created' | 'arch:updated' | 'arch:deleted';

    log.debug('Broadcasting arch event', {
        wsType,
        clientCount: webSocket.getClientCount(),
    });

    webSocket.broadcastArchEvent(
        wsType,
        event.relativePath,
        event.markdown,
        event.html,
    );
}
