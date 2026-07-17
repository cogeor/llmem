/**
 * Message router for `VSCodeDataProvider`.
 *
 * Extracted from `services/vscodeDataProvider.ts` (Loop 22 file-size split).
 * Pure browser code — no node/vscode imports.
 *
 * The provider owns all the mutable state (cached data, listener sets, and
 * the per-request pending maps); this module is the pure dispatch body of
 * the old `handleMessage` switch. The provider threads its state in through
 * `MessageRouterContext`, so behaviour is byte-for-byte identical — only the
 * code location changed.
 */

import { GraphData, WorkTreeNode, VisNode, VisEdge, DesignDoc } from '../../types';
import { WatchToggleResult } from '../dataProvider';
import { WebviewLogger } from '../webview-logger';
import type { FolderTreeData } from '../../../../contracts/folder-tree';
import type { FolderEdgelistData } from '../../../../contracts/folder-edges';
import type { PanelOutboundMessage } from '../../../../contracts/panel-messages';

/** Resolver pair for a pending folder-node request. */
export interface PendingFolderNodeRequest {
    resolve: (data: { nodes: VisNode[]; edges: VisEdge[] } | null) => void;
    reject: (error: Error) => void;
}

/** Resolver pair for a pending watch toggle. */
export interface PendingWatchToggle {
    resolve: (result: WatchToggleResult) => void;
    reject: (error: Error) => void;
    timeoutHandle: ReturnType<typeof setTimeout>;
}

/** Resolver pair for a pending folder-tree load. */
export interface PendingFolderTreeRequest {
    resolve: (data: FolderTreeData) => void;
    reject: (error: Error) => void;
    timeoutHandle: ReturnType<typeof setTimeout>;
}

/** Resolver pair for a pending folder-edges load. */
export interface PendingFolderEdgesRequest {
    resolve: (data: FolderEdgelistData) => void;
    reject: (error: Error) => void;
    timeoutHandle: ReturnType<typeof setTimeout>;
}

/**
 * Mutable state the router operates on. The provider passes itself-shaped
 * handles in so the router can update cached data and resolve pending
 * promises exactly as the inline switch used to.
 */
export interface MessageRouterContext {
    logger: WebviewLogger;
    refreshListeners: Set<() => void>;
    watchedPathsListeners: Set<(paths: string[]) => void>;
    pendingFolderNodeRequests: Map<string, PendingFolderNodeRequest>;
    pendingWatchToggles: Map<string, PendingWatchToggle>;
    pendingFolderTreeRequests: Map<string, PendingFolderTreeRequest>;
    pendingFolderEdgesRequests: Map<string, PendingFolderEdgesRequest>;
    setGraphData: (data: GraphData | null) => void;
    setWorkTree: (tree: WorkTreeNode | null) => void;
    setDesignDocs: (docs: Record<string, DesignDoc>) => void;
    setCachedWatchedPaths: (paths: string[]) => void;
    resolveDataReady: () => void;
}

/**
 * Pure dispatch body of `VSCodeDataProvider.handleMessage`. Identical
 * semantics to the prior inline switch — only the resolver/state access is
 * threaded through `ctx`.
 */
export function routeMessage(message: PanelOutboundMessage, ctx: MessageRouterContext): void {
    switch (message.type) {
        case 'data:init':
            // Initial data from extension
            ctx.setGraphData(message.data.graphData);
            ctx.setWorkTree(message.data.workTree);
            ctx.setDesignDocs(message.data.designDocs || {});
            ctx.resolveDataReady();
            break;

        case 'data:refresh':
            // Hot reload update
            ctx.setGraphData(message.data.graphData);
            ctx.setWorkTree(message.data.workTree);
            ctx.setDesignDocs(message.data.designDocs || {});

            // Notify all refresh listeners
            ctx.refreshListeners.forEach(cb => cb());
            break;

        case 'data:folderNodes': {
            // Response for folder node request
            const folderPath = message.folderPath;
            const pending = ctx.pendingFolderNodeRequests.get(folderPath);
            if (pending) {
                if (message.error) {
                    pending.reject(new Error(message.error));
                } else {
                    pending.resolve(message.data ?? null);
                }
                ctx.pendingFolderNodeRequests.delete(folderPath);
            }
            break;
        }

        case 'state:watchedPaths': {
            // The same message arrives in two flows:
            //   (a) initial restore — extension pushes persisted watched
            //       paths on `webview:ready` with no `requestId`;
            //   (b) toggle response — extension echoes the `requestId`
            //       we supplied in `toggleWatch` so we can resolve the
            //       right pending promise (Loop 14 — see comment on
            //       `pendingWatchToggles`).
            ctx.logger.log(`[VSCodeDataProvider] Received ${message.paths?.length || 0} watched paths`);
            ctx.setCachedWatchedPaths(message.paths || []);
            ctx.watchedPathsListeners.forEach(cb => cb(message.paths || []));

            const requestId: unknown = message.requestId;
            if (typeof requestId === 'string' && ctx.pendingWatchToggles.has(requestId)) {
                const entry = ctx.pendingWatchToggles.get(requestId)!;
                clearTimeout(entry.timeoutHandle);
                ctx.pendingWatchToggles.delete(requestId);
                entry.resolve({
                    success: true,
                    addedFiles: message.addedFiles,
                    removedFiles: message.removedFiles,
                });
            } else if (typeof requestId === 'undefined' && ctx.pendingWatchToggles.size > 0) {
                // Legacy fallback: an older extension host that does not
                // yet echo `requestId`. Resolve the oldest pending entry
                // so toggles still complete; once the extension is
                // updated this branch becomes unreachable.
                const oldestKey = ctx.pendingWatchToggles.keys().next().value;
                if (oldestKey !== undefined) {
                    const entry = ctx.pendingWatchToggles.get(oldestKey)!;
                    clearTimeout(entry.timeoutHandle);
                    ctx.pendingWatchToggles.delete(oldestKey);
                    entry.resolve({
                        success: true,
                        addedFiles: message.addedFiles,
                        removedFiles: message.removedFiles,
                    });
                }
            }
            // If `requestId` is present but unknown, the response is
            // either stale (already timed out) or for a different
            // provider instance. Drop it silently.
            break;
        }

        case 'data:folderTree': {
            const requestId: unknown = message.requestId;
            if (typeof requestId !== 'string') break;
            const pending = ctx.pendingFolderTreeRequests.get(requestId);
            if (!pending) break;
            clearTimeout(pending.timeoutHandle);
            ctx.pendingFolderTreeRequests.delete(requestId);
            if (message.error) {
                pending.reject(new Error(String(message.error)));
            } else {
                pending.resolve(message.data as FolderTreeData);
            }
            break;
        }

        case 'data:folderEdges': {
            const requestId: unknown = message.requestId;
            if (typeof requestId !== 'string') break;
            const pending = ctx.pendingFolderEdgesRequests.get(requestId);
            if (!pending) break;
            clearTimeout(pending.timeoutHandle);
            ctx.pendingFolderEdgesRequests.delete(requestId);
            if (message.error) {
                pending.reject(new Error(String(message.error)));
            } else {
                pending.resolve(message.data as FolderEdgelistData);
            }
            break;
        }
    }
}
