
import { GraphData, WorkTreeNode, VisNode, VisEdge, DesignDoc } from '../types';

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
     * Get the VS Code API for sending messages (VS Code mode only).
     * Returns null in standalone mode.
     */
    getVscodeApi(): any;
}
