
import { GraphData } from '../types';

/**
 * Service to load and access graph data.
 * Assumes window.GRAPH_DATA or window.GRAPH_DATA_URL is populated by the generator.
 */
export class GraphDataService {
    private data: GraphData | null = null;

    async load(): Promise<GraphData> {
        if (this.data) return this.data;

        if (window.GRAPH_DATA) {
            this.data = window.GRAPH_DATA;
        } else if (window.GRAPH_DATA_URL) {
            try {
                const response = await fetch(window.GRAPH_DATA_URL);
                this.data = await response.json();
            } catch (err) {
                console.error("Failed to load graph data", err);
                // Return empty structure on failure to prevent crash
                this.data = { importGraph: { nodes: [], edges: [] }, callGraph: { nodes: [], edges: [] } };
            }
        } else {
            // Fallback/Mock
            this.data = { importGraph: { nodes: [], edges: [] }, callGraph: { nodes: [], edges: [] } };
        }
        return this.data!;
    }
}
