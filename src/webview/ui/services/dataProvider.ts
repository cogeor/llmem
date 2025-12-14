
import { GraphData, WorkTreeNode } from '../types';

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

    /** Load all design documents (path -> HTML content) */
    loadDesignDocs(): Promise<Record<string, string>>;

    /**
     * Subscribe to refresh events.
     * Called when data has been updated (hot reload).
     * @returns Unsubscribe function
     */
    onRefresh(callback: () => void): () => void;
}
