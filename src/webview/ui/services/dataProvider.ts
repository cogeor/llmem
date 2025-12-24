
import { GraphData, WorkTreeNode, VisNode, VisEdge, DesignDoc } from '../types';

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
 * DataProvider interface for loading webview data.
 * Used by components to fetch graph, worktree, and design doc data.
 *
 * Implementations:
 * - StaticDataProvider: For standalone HTML mode (reads from window.*)
 * - VSCodeDataProvider: For VS Code extension mode (receives via postMessage)
 */
export interface DataProvider {
    /** Load graph data (import and call graphs) */
    loadGraphData(): Promise<GraphData>;

    /** Load the worktree (file system hierarchy) */
    loadWorkTree(): Promise<WorkTreeNode>;

    /** Load all design documents (path -> DesignDoc with markdown + HTML) */
    loadDesignDocs(): Promise<Record<string, DesignDoc>>;

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

    /**
     * Get the VS Code API for sending messages (VS Code mode only).
     * Returns null in standalone mode.
     * @deprecated Use toggleWatch() and other abstracted methods instead of direct API access.
     */
    getVscodeApi(): any;
}
