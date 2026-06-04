/**
 * Panel folder-data handlers (Loop 15 split).
 *
 * Carved verbatim from the former `panel.ts` monolith: the per-message
 * workflows that lazily load folder graph data / folder-tree / folder-edges.
 * The former `private` methods read `this._ctx` and posted to
 * `this._panel.webview`; here they are free functions taking a narrow
 * `PanelHost` so the controller stays thin.
 *
 * The toggle-watch + hot-reload-init workflows live in the sibling
 * `panel-watch-handlers.ts`.
 *
 * Dynamic import (`import('../../graph/edgelist')`) is preserved exactly.
 *
 * Re-exported through the `panel.ts` barrel; consumed by the message router.
 */

import { createLogger } from '../../common/logger';
import { scanFolderRecursive } from '../../application/scan';
import { parseGraphId } from '../../core/ids';
import { FolderTreeStore } from '../../graph/folder-tree-store';
import { FolderEdgelistStore } from '../../graph/folder-edges-store';
import type { PanelHost } from './panel-host';

const log = createLogger('panel');

/**
 * Load nodes and edges for a folder on-demand (lazy loading).
 */
export async function loadFolderNodes(host: PanelHost, folderPath: string): Promise<void> {
    const ctx0 = host.getCtx();
    if (!ctx0) {
        host.webview.postMessage({
            type: 'data:folderNodes',
            folderPath,
            error: 'Context not initialized',
        });
        return;
    }
    const ctx = ctx0;

    log.debug('Loading nodes for folder', { folderPath });

    try {
        // Loop 04: single per-panel context — `WorkspaceIO.create` no
        // longer runs per-handler. `scanFolderRecursive` takes the
        // context directly.
        await scanFolderRecursive(ctx, { folderPath });

        // Load the updated edge lists to get the new nodes and edges.
        //
        // Loop 13 (codebase-quality-v2): the load may throw
        // SchemaMismatchError when the on-disk envelope predates the
        // resolver swap. Surface a status to the webview and trigger
        // a fresh recursive rescan, then retry the load.
        const { CallEdgeListStore, SchemaMismatchError } = await import('../../graph/edgelist');
        const callStore = new CallEdgeListStore(ctx.artifactRoot, ctx.io);
        try {
            await callStore.load();
        } catch (e) {
            if (!(e instanceof SchemaMismatchError)) throw e;
            host.webview.postMessage({
                type: 'data:folderNodes',
                folderPath,
                error: 'schema-mismatch: rescanning',
            });
            await scanFolderRecursive(ctx, { folderPath });
            await callStore.load();
        }

        // Get nodes and edges for this folder. Use the graph-ID contract:
        // reduce each endpoint to its underlying file, then check folder
        // containment. The previous code's `+ ENTITY_SEPARATOR` clauses
        // were dead (folderPath cannot also be a file ID used as an
        // entity prefix); see src/core/ids.ts.
        const nodes = callStore.getNodesByFolder(folderPath);
        const fileFor = (graphId: string): string => {
            const parsed = parseGraphId(graphId);
            return parsed.kind === 'entity' ? parsed.fileId : graphId;
        };
        const isInFolder = (graphId: string): boolean => {
            const file = fileFor(graphId);
            return file === folderPath || file.startsWith(folderPath + '/');
        };
        const edges = callStore.getEdges().filter(e => isInFolder(e.source) || isInFolder(e.target));

        // Convert to VisNode/VisEdge format
        const visNodes = nodes.map(n => ({
            id: n.id,
            label: n.name,
            group: n.fileId,
            fileId: n.fileId
        }));

        const visEdges = edges.map(e => ({
            from: e.source,
            to: e.target
        }));

        log.debug('Loaded folder graph', {
            folderPath,
            nodes: visNodes.length,
            edges: visEdges.length,
        });

        host.webview.postMessage({
            type: 'data:folderNodes',
            folderPath,
            data: {
                nodes: visNodes,
                edges: visEdges
            }
        });
    } catch (e: any) {
        log.error('Failed to load folder nodes', {
            folderPath,
            error: e instanceof Error ? e.message : String(e),
        });
        host.webview.postMessage({
            type: 'data:folderNodes',
            folderPath,
            error: e.message
        });
    }
}

/**
 * Load `.artifacts/folder-tree.json` and post `data:folderTree` back to
 * the webview, echoing the original `requestId`. Loop 02.
 *
 * Loop 04: shares the panel's `_ctx` instead of constructing a fresh
 * `WorkspaceIO` per call. `FolderTreeStore.load()` raises
 * `FolderTreeLoadError` for missing-file / parse-error / schema-error
 * / unknown-version cases — relay `error.message` back so the
 * webview-side `pendingFolderTreeRequests.reject(...)` path fires.
 */
export async function loadFolderTree(host: PanelHost, requestId: string | undefined): Promise<void> {
    const ctx = host.getCtx();
    if (!ctx) {
        host.webview.postMessage({
            type: 'data:folderTree',
            requestId,
            error: 'Context not initialized',
        });
        return;
    }

    try {
        const store = new FolderTreeStore(ctx.artifactRoot, ctx.io);
        const data = await store.load();
        host.webview.postMessage({
            type: 'data:folderTree',
            requestId,
            data,
        });
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log.error('Failed to load folder tree', { error: message });
        host.webview.postMessage({
            type: 'data:folderTree',
            requestId,
            error: message,
        });
    }
}

/**
 * Load `.artifacts/folder-edgelist.json` and post `data:folderEdges`
 * back to the webview, echoing the original `requestId`. Loop 02.
 * Same posture as `loadFolderTree` — see the comment there.
 */
export async function loadFolderEdges(host: PanelHost, requestId: string | undefined): Promise<void> {
    const ctx = host.getCtx();
    if (!ctx) {
        host.webview.postMessage({
            type: 'data:folderEdges',
            requestId,
            error: 'Context not initialized',
        });
        return;
    }

    try {
        const store = new FolderEdgelistStore(ctx.artifactRoot, ctx.io);
        const data = await store.load();
        host.webview.postMessage({
            type: 'data:folderEdges',
            requestId,
            data,
        });
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log.error('Failed to load folder edges', { error: message });
        host.webview.postMessage({
            type: 'data:folderEdges',
            requestId,
            error: message,
        });
    }
}
