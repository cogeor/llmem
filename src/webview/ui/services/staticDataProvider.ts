
import { DataProvider } from './dataProvider';
import { GraphData, WorkTreeNode } from '../types';

/**
 * DataProvider for standalone HTML mode.
 * Reads data from window.* globals that are injected by the generator.
 */
export class StaticDataProvider implements DataProvider {

    async loadGraphData(): Promise<GraphData> {
        return window.GRAPH_DATA || {
            importGraph: { nodes: [], edges: [] },
            callGraph: { nodes: [], edges: [] }
        };
    }

    async loadWorkTree(): Promise<WorkTreeNode> {
        return window.WORK_TREE || { name: "root", path: "", type: "directory", children: [] } as WorkTreeNode;
    }

    async loadDesignDocs(): Promise<Record<string, string>> {
        return window.DESIGN_DOCS || {};
    }

    onRefresh(_callback: () => void): () => void {
        // Static mode - no refresh events (data is baked in)
        return () => { };
    }

    getVscodeApi(): any {
        return null; // Not available in standalone mode
    }
}
