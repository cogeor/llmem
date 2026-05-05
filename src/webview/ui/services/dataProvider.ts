
import { GraphData, WorkTreeNode, VisNode, VisEdge, DesignDoc } from '../types';
import type { FolderTreeData } from '../../../graph/folder-tree';
import type { FolderEdgelistData } from '../../../graph/folder-edges';

/**
 * Result of a watch toggle operation
 */
export interface WatchToggleResult {
    success: boolean;
    addedFiles?: string[];
    removedFiles?: string[];
    message?: string;
}

/**
 * Identifies which environment hosts the webview UI.
 * Components must read this instead of probing for VS Code APIs directly.
 */
export type HostKind = 'vscode' | 'browser';

/**
 * DataProvider interface for loading webview data.
 * Used by components to fetch graph, worktree, and design doc data.
 *
 * Implementations:
 * - StaticDataProvider: For standalone HTML mode (reads from window.*)
 * - VSCodeDataProvider: For VS Code extension mode (receives via postMessage)
 */
export interface DataProvider {
    /**
     * Identifies the host environment. Components must read this instead of
     * probing for `acquireVsCodeApi` or related globals — keeps environment
     * coupling inside the DataProvider boundary (Loop 14).
     */
    readonly hostKind: HostKind;

    /**
     * Reveal a specific line range in the host editor (VS Code only — no-op
     * in standalone browser mode). Implementations log a warning when the
     * host cannot honor the request.
     */
    revealRange(filePath: string, line: number): void;

    /**
     * Open a URL externally (in VS Code: delegates to the extension host;
     * in browser: opens a new window with `noopener`).
     */
    openExternal(url: string): void;

    /** Load graph data (import and call graphs) */
    loadGraphData(): Promise<GraphData>;

    /** Load the worktree (file system hierarchy) */
    loadWorkTree(): Promise<WorkTreeNode>;

    /** Load all design documents (path -> DesignDoc with markdown + HTML) */
    loadDesignDocs(): Promise<Record<string, DesignDoc>>;

    /**
     * Load the folder-tree artifact (folder hierarchy with file counts,
     * documentation flags, and recursive LOC totals). Loop 13.
     *
     * Required on every host — every consumer of `'packages'` view needs
     * the tree. VS Code mode resolves through the panel's
     * `data:folderTree` echo (`src/extension/panel.ts::_loadFolderTree`,
     * loop 02). The static path reads `window.FOLDER_TREE`.
     */
    loadFolderTree(): Promise<FolderTreeData>;

    /**
     * Load the folder-edgelist artifact (folder→folder import + call edges
     * with `weightP90` density threshold). Loop 13.
     *
     * VS Code mode resolves through the panel's `data:folderEdges` echo
     * (`src/extension/panel.ts::_loadFolderEdges`, loop 02).
     */
    loadFolderEdges(): Promise<FolderEdgelistData>;

    /**
     * Subscribe to refresh events.
     * Called when data has been updated (hot reload).
     * @returns Unsubscribe function
     */
    onRefresh(callback: () => void): () => void;

    /**
     * Load nodes and edges for a specific folder on-demand.
     * Used for call graph lazy loading.
     * Returns null if not supported (e.g., static mode).
     */
    loadFolderNodes?(folderPath: string): Promise<{ nodes: VisNode[]; edges: VisEdge[] } | null>;

    /**
     * Subscribe to watched paths restoration.
     * Called when persisted watched paths are loaded from disk.
     * Only available in VS Code mode.
     */
    onWatchedPathsRestored?(callback: (paths: string[]) => void): () => void;

    /**
     * Toggle watch state for a path (file or folder).
     * Abstracts the mode-specific implementation (VS Code postMessage vs HTTP API).
     * @param path Relative path to toggle
     * @param watched New watch state (true = add to watch, false = remove)
     * @returns Result of the toggle operation
     */
    toggleWatch(path: string, watched: boolean): Promise<WatchToggleResult>;

    /**
     * Get a specific design doc by key.
     * Optional - may not be implemented by all providers.
     */
    getDesignDoc?(key: string): DesignDoc | undefined;

    /**
     * Save a design doc to the .arch directory.
     * @param path Path relative to .arch (e.g., "src/parser" or "src/parser.md")
     * @param markdown Markdown content to save
     * @returns Success status
     */
    saveDesignDoc?(path: string, markdown: string): Promise<boolean>;

    /**
     * Subscribe to design doc changes (created, updated, deleted).
     * Called when a design doc is modified externally or via WebSocket.
     * @param callback Function called with (path, doc | null)
     * @returns Unsubscribe function
     */
    onDesignDocChange?(callback: (path: string, doc: DesignDoc | null) => void): () => void;
}
