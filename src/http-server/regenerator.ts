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

import { generateGraph as generateGraphLauncher } from '../viewer-generator';
import { refreshFileGraph } from '../application/refresh-graph';
import { ImportEdgeListStore, CallEdgeListStore } from '../graph/edgelist';
import type { Logger } from '../core/logger';
import type { WebSocketService } from './websocket';
import type { ArchFileEvent } from './arch-watcher';
import { createLogger } from '../common/logger';
import type { WorkspaceContext } from '../application/workspace-context';

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
 * Bring every changed source path's edges up to date, then regenerate the
 * webview.
 *
 * Consistency contract: each file is processed through a REMOVE-then-add path,
 * not a blind append, so an edit that deletes an import (or a deleted file)
 * drops the now-gone edge. This is what keeps derived state — crucially the
 * import-cycle (red) edges — correct on live recompute: if a code change breaks
 * a cycle, the stale edge vanishes and `computeInCycleEdgeKeys` (run fresh
 * inside `regenerateWebview`) no longer flags it. A prior version called the
 * append-only `scanFile` here, which left removed edges behind and could keep a
 * broken cycle painted red until a full rescan.
 *
 *   - File still present  → `refreshFileGraph` (LS-07 `removeByFile` by SOURCE
 *     *and* TARGET, then re-gate + re-parse). It also applies the SAME LS-03
 *     gates as the initial folder scan, so an incremental update can't add
 *     edges the full scan would have excluded.
 *   - File deleted        → purge its edges from both stores directly
 *     (`refreshFileGraph` early-returns on a missing file without removing).
 */
export async function rescanSourcesAndRegenerate(
    files: string[],
    deps: RegenerateDeps,
): Promise<void> {
    log.info('Regenerating edges for changed files', { count: files.length });

    for (const file of files) {
        const exists = await deps.ctx.io.exists(file).catch(() => false);
        if (exists) {
            await refreshFileGraph(deps.ctx, { filePath: file });
        } else {
            await purgeDeletedFile(deps.ctx, file);
        }
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
 * Purge a deleted source file's edges from both split stores (by SOURCE *and*
 * TARGET, via LS-07 `removeByFile`). `refreshFileGraph` cannot do this — it
 * stats the file first and early-returns when it is gone, leaving inbound edges
 * (and any cycle running through the file) stale. Saves only when something was
 * actually removed so a spurious `unlink` for a never-indexed file is a no-op.
 */
async function purgeDeletedFile(
    ctx: WorkspaceContext,
    relPath: string,
): Promise<void> {
    const importStore = new ImportEdgeListStore(ctx.artifactRoot, ctx.io);
    const callStore = new CallEdgeListStore(ctx.artifactRoot, ctx.io);
    await importStore.load();
    await callStore.load();

    const before = importStore.getStats().edges + callStore.getStats().edges;
    importStore.removeByFile(relPath);
    callStore.removeByFile(relPath);
    const after = importStore.getStats().edges + callStore.getStats().edges;

    if (after !== before) {
        await importStore.save();
        await callStore.save();
        log.info('Purged deleted file from edge lists', { file: relPath, removedEdges: before - after });
    }
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
