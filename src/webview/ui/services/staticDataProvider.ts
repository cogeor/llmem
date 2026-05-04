
import { DataProvider, HostKind, WatchToggleResult } from './dataProvider';
import { GraphData, WorkTreeNode, DesignDoc } from '../types';
import { WatchApiClient } from './watchApiClient';
import { designDocCache } from './designDocCache';
import { liveReloadClient } from '../../live-reload';
import type { FolderTreeData } from '../../../graph/folder-tree';
import type { FolderEdgelistData } from '../../../graph/folder-edges';

/**
 * Schema-version constants for the folder artifacts. Loop 13 mirrors the
 * runtime-truth gate from `FolderTreeSchema.parse` / `FolderEdgelistSchema.parse`
 * with a manual `schemaVersion` check because runtime-importing the schemas
 * from `src/graph/folder-tree.ts` / `folder-edges.ts` would pull in their
 * Node-only `path` import (used by `folderOf`), breaking the browser
 * bundle. The version literals MUST stay in sync with
 * `FOLDER_TREE_SCHEMA_VERSION` / `FOLDER_EDGES_SCHEMA_VERSION` defined in
 * those modules; if they ever bump, this file's checks must bump too.
 */
const FOLDER_TREE_SCHEMA_VERSION_EXPECTED = 1;
const FOLDER_EDGES_SCHEMA_VERSION_EXPECTED = 1;

/**
 * DataProvider for standalone HTML mode.
 * Reads data from window.* globals that are injected by the generator.
 * Uses DesignDocCache for real-time design doc updates.
 */
export class StaticDataProvider implements DataProvider {
    public readonly hostKind: HostKind = 'browser';

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

    async loadFolderTree(): Promise<FolderTreeData> {
        const raw = window.FOLDER_TREE;
        if (raw === undefined) {
            throw new Error(
                '[StaticDataProvider] window.FOLDER_TREE is not set — folder_tree.js failed to load or the static webview was generated without folder artifacts.',
            );
        }
        // Manual schema-version gate (browser bundle cannot pull
        // FolderTreeSchema — see `FOLDER_TREE_SCHEMA_VERSION_EXPECTED` note above).
        const candidate = raw as { schemaVersion?: unknown };
        if (candidate.schemaVersion !== FOLDER_TREE_SCHEMA_VERSION_EXPECTED) {
            throw new Error(
                `[StaticDataProvider] window.FOLDER_TREE has unexpected schemaVersion ${String(candidate.schemaVersion)} ` +
                `(expected ${FOLDER_TREE_SCHEMA_VERSION_EXPECTED}). Generator and consumer have drifted; rebuild the static webview.`,
            );
        }
        return raw;
    }

    async loadFolderEdges(): Promise<FolderEdgelistData> {
        const raw = window.FOLDER_EDGES;
        if (raw === undefined) {
            throw new Error(
                '[StaticDataProvider] window.FOLDER_EDGES is not set — folder_edges.js failed to load or the static webview was generated without folder artifacts.',
            );
        }
        const candidate = raw as { schemaVersion?: unknown };
        if (candidate.schemaVersion !== FOLDER_EDGES_SCHEMA_VERSION_EXPECTED) {
            throw new Error(
                `[StaticDataProvider] window.FOLDER_EDGES has unexpected schemaVersion ${String(candidate.schemaVersion)} ` +
                `(expected ${FOLDER_EDGES_SCHEMA_VERSION_EXPECTED}). Generator and consumer have drifted; rebuild the static webview.`,
            );
        }
        return raw;
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

    /**
     * Standalone (browser) mode cannot reveal a range in an editor. Loop 14
     * keeps the surface uniform across hosts so components don't branch on
     * `hostKind` for behavioural calls — the no-op + warning is the
     * contract.
     */
    revealRange(filePath: string, line: number): void {
        console.warn(
            `[StaticDataProvider] revealRange not supported in browser mode (path=${filePath}, line=${line})`
        );
    }

    /**
     * Open a URL in a new browser window. `noopener` so the popup cannot
     * navigate the opener.
     */
    openExternal(url: string): void {
        window.open(url, '_blank', 'noopener');
    }
}
