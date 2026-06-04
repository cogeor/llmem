/**
 * Panel outbound message contracts (H2).
 *
 * Single source of truth for the extension -> webview `postMessage` payloads
 * sent by the panel handlers. Each interface pins the exact field names the
 * handlers put on the wire alongside the discriminant `type`.
 *
 * Emit sites:
 *   - `data:init`          — src/extension/panel/panel-watch-handlers.ts
 *                            (`startHotReloadAndSendInitialData`)
 *   - `data:refresh`       — src/extension/panel/panel-watch-handlers.ts
 *                            (`handleToggleWatch` + hot-reload callback)
 *   - `state:watchedPaths` — src/extension/panel/panel-watch-handlers.ts
 *                            (`handleToggleWatch`, initial watched-files send)
 *   - `data:folderNodes`   — src/extension/panel/panel-data-handlers.ts
 *                            (`loadFolderNodes`)
 *   - `data:folderTree`    — src/extension/panel/panel-data-handlers.ts
 *                            (`loadFolderTree`)
 *   - `data:folderEdges`   — src/extension/panel/panel-data-handlers.ts
 *                            (`loadFolderEdges`)
 *
 * Browser-safe: imports are type-only and reference ONLY other
 * `src/contracts/*` modules (no node/vscode/parser).
 */

import type { GraphData, VisNode, VisEdge, WorkTreeNode, DesignDoc } from './webview-payloads';
import type { FolderTreeData } from './folder-tree';
import type { FolderEdgelistData } from './folder-edges';

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/**
 * The rendered viewer payload carried by `data:init` / `data:refresh`.
 * Mirrors `ViewerDataRendered` (src/extension/panel/panel-markdown-renderer.ts)
 * but expressed with browser-safe contract types only.
 */
export interface ViewerDataPayload {
    graphData: GraphData;
    workTree: WorkTreeNode;
    designDocs: Record<string, DesignDoc>;
}

/** Folder graph slice posted by `data:folderNodes` on success. */
export interface FolderNodesData {
    nodes: VisNode[];
    edges: VisEdge[];
}

// ---------------------------------------------------------------------------
// Message interfaces (one per `type`)
// ---------------------------------------------------------------------------

/** Initial data sent once the webview signals `webview:ready`. */
export interface DataInitMessage {
    type: 'data:init';
    data: ViewerDataPayload;
}

/** Refreshed data after a toggle-watch or a hot-reload tick. */
export interface DataRefreshMessage {
    type: 'data:refresh';
    data: ViewerDataPayload;
}

/**
 * Watched-paths state echoed back after a toggle, plus the initial
 * watched-files send. `requestId` echoes the webview's toggle id (absent on
 * the initial send). `addedFiles` is present on add, `removedFiles` on remove,
 * neither on the initial send.
 */
export interface StateWatchedPathsMessage {
    type: 'state:watchedPaths';
    paths: string[];
    requestId?: string;
    addedFiles?: string[];
    removedFiles?: string[];
}

/**
 * Lazy folder graph load. Carries `data` on success or `error` on failure;
 * `folderPath` is always echoed.
 */
export interface DataFolderNodesMessage {
    type: 'data:folderNodes';
    folderPath: string;
    data?: FolderNodesData;
    error?: string;
}

/**
 * `folder-tree.json` load. Carries `data` on success or `error` on failure;
 * `requestId` echoes the webview request id when present.
 */
export interface DataFolderTreeMessage {
    type: 'data:folderTree';
    requestId?: string;
    data?: FolderTreeData;
    error?: string;
}

/**
 * `folder-edgelist.json` load. Carries `data` on success or `error` on
 * failure; `requestId` echoes the webview request id when present.
 */
export interface DataFolderEdgesMessage {
    type: 'data:folderEdges';
    requestId?: string;
    data?: FolderEdgelistData;
    error?: string;
}

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

/**
 * Every extension -> webview `postMessage` payload, discriminated on `type`.
 */
export type PanelOutboundMessage =
    | DataInitMessage
    | DataRefreshMessage
    | StateWatchedPathsMessage
    | DataFolderNodesMessage
    | DataFolderTreeMessage
    | DataFolderEdgesMessage;

/** The literal `type` discriminant of every outbound message. */
export type PanelOutboundMessageType = PanelOutboundMessage['type'];
