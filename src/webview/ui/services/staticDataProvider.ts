
import { DataProvider, WatchToggleResult } from './dataProvider';
import { GraphData, WorkTreeNode, DesignDoc } from '../types';
import { WatchApiClient } from './watchApiClient';

/**
 * DataProvider for standalone HTML mode.
 * Reads data from window.* globals that are injected by the generator.
 */
export class StaticDataProvider implements DataProvider {
    private watchApiClient: WatchApiClient;

    constructor() {
        this.watchApiClient = new WatchApiClient();
    }

    async loadGraphData(): Promise<GraphData> {
        return window.GRAPH_DATA || {
            importGraph: { nodes: [], edges: [] },
            callGraph: { nodes: [], edges: [] }
        };
    }

    async loadWorkTree(): Promise<WorkTreeNode> {
        return window.WORK_TREE || { name: "root", path: "", type: "directory", children: [] } as WorkTreeNode;
    }

    async loadDesignDocs(): Promise<Record<string, DesignDoc>> {
        return window.DESIGN_DOCS || {};
    }

    onRefresh(_callback: () => void): () => void {
        // Static mode - no refresh events (data is baked in, WebSocket handles full page reload)
        return () => { };
    }

    /**
     * Toggle watch state for a path using the HTTP API.
     */
    async toggleWatch(path: string, watched: boolean): Promise<WatchToggleResult> {
        try {
            const response = await this.watchApiClient.toggleWatch(path, watched);
            return {
                success: response.success,
                addedFiles: response.addedFiles,
                removedFiles: response.removedFiles,
                message: response.message
            };
        } catch (error) {
            return {
                success: false,
                message: error instanceof Error ? error.message : String(error)
            };
        }
    }

    getVscodeApi(): any {
        return null; // Not available in standalone mode
    }
}
