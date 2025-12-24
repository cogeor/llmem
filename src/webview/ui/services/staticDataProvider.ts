
import { DataProvider, WatchToggleResult } from './dataProvider';
import { GraphData, WorkTreeNode, DesignDoc } from '../types';
import { WatchApiClient } from './watchApiClient';
import { designDocCache } from './designDocCache';
import { liveReloadClient } from '../../live-reload';

/**
 * DataProvider for standalone HTML mode.
 * Reads data from window.* globals that are injected by the generator.
 * Uses DesignDocCache for real-time design doc updates.
 */
export class StaticDataProvider implements DataProvider {
    private watchApiClient: WatchApiClient;
    private refreshCallbacks: Set<() => void> = new Set();
    private designDocCallbacks: Set<(path: string, doc: DesignDoc | null) => void> = new Set();

    constructor() {
        this.watchApiClient = new WatchApiClient();

        // Subscribe to graph updates from WebSocket
        liveReloadClient.on('graph:updated', () => {
            console.log('[StaticDataProvider] Graph updated, triggering refresh');
            this.triggerRefresh();
        });

        // Subscribe to design doc changes
        designDocCache.onChange((path, doc, type) => {
            console.log(`[StaticDataProvider] Design doc ${type}: ${path}`);
            this.notifyDesignDocChange(path, doc);
        });
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
        // Use cached docs instead of window.DESIGN_DOCS directly
        return designDocCache.getAll();
    }

    /**
     * Get a specific design doc
     */
    getDesignDoc(key: string): DesignDoc | undefined {
        return designDocCache.get(key);
    }

    /**
     * Save a design doc
     */
    async saveDesignDoc(path: string, markdown: string): Promise<boolean> {
        return designDocCache.save(path, markdown);
    }

    /**
     * Subscribe to refresh events
     */
    onRefresh(callback: () => void): () => void {
        this.refreshCallbacks.add(callback);
        return () => this.refreshCallbacks.delete(callback);
    }

    /**
     * Subscribe to design doc changes
     */
    onDesignDocChange(callback: (path: string, doc: DesignDoc | null) => void): () => void {
        this.designDocCallbacks.add(callback);
        return () => this.designDocCallbacks.delete(callback);
    }

    /**
     * Trigger refresh callbacks
     */
    private triggerRefresh(): void {
        for (const callback of this.refreshCallbacks) {
            try {
                callback();
            } catch (e) {
                console.error('[StaticDataProvider] Refresh callback error:', e);
            }
        }
    }

    /**
     * Notify design doc change listeners
     */
    private notifyDesignDocChange(path: string, doc: DesignDoc | null): void {
        for (const callback of this.designDocCallbacks) {
            try {
                callback(path, doc);
            } catch (e) {
                console.error('[StaticDataProvider] Design doc callback error:', e);
            }
        }
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
