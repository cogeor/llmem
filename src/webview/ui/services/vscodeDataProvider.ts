
import { DataProvider } from './dataProvider';
import { GraphData, WorkTreeNode, VisNode, VisEdge } from '../types';

declare const acquireVsCodeApi: () => any;

/**
 * DataProvider for VS Code webview mode.
 * Receives data from the extension host via postMessage.
 */
export class VSCodeDataProvider implements DataProvider {
    private vscode: any;
    private refreshListeners: Set<() => void> = new Set();
    private watchedPathsListeners: Set<(paths: string[]) => void> = new Set();

    // Cached data from extension
    private graphData: GraphData | null = null;
    private workTree: WorkTreeNode | null = null;
    private designDocs: Record<string, string> = {};

    // Promise for initial data load
    private dataReady: Promise<void>;
    private resolveDataReady!: () => void;

    // Pending folder node requests
    private pendingFolderNodeRequests: Map<string, {
        resolve: (data: { nodes: VisNode[]; edges: VisEdge[] } | null) => void;
        reject: (error: Error) => void;
    }> = new Map();

    constructor() {
        this.vscode = acquireVsCodeApi();
        this.dataReady = new Promise(resolve => {
            this.resolveDataReady = resolve;
        });

        window.addEventListener('message', (event) => this.handleMessage(event.data));

        // Signal ready to extension - it will send initial data
        this.vscode.postMessage({ command: 'webview:ready' });
    }

    private handleMessage(message: any) {
        switch (message.type) {
            case 'data:init':
                // Initial data from extension
                this.graphData = message.data.graphData;
                this.workTree = message.data.workTree;
                this.designDocs = message.data.designDocs || {};
                this.resolveDataReady();
                break;

            case 'data:refresh':
                // Hot reload update
                this.graphData = message.data.graphData;
                this.workTree = message.data.workTree;
                this.designDocs = message.data.designDocs || {};

                // Notify all refresh listeners
                this.refreshListeners.forEach(cb => cb());
                break;

            case 'data:folderNodes':
                // Response for folder node request
                const folderPath = message.folderPath;
                const pending = this.pendingFolderNodeRequests.get(folderPath);
                if (pending) {
                    if (message.error) {
                        pending.reject(new Error(message.error));
                    } else {
                        pending.resolve(message.data);
                    }
                    this.pendingFolderNodeRequests.delete(folderPath);
                }
                break;

            case 'state:watchedPaths':
                // Restore watched paths from persisted state
                console.log(`[VSCodeDataProvider] Received ${message.paths?.length || 0} watched paths`);
                this.watchedPathsListeners.forEach(cb => cb(message.paths || []));
                break;
        }
    }

    async loadGraphData(): Promise<GraphData> {
        await this.dataReady;
        return this.graphData!;
    }

    async loadWorkTree(): Promise<WorkTreeNode> {
        await this.dataReady;
        return this.workTree!;
    }

    async loadDesignDocs(): Promise<Record<string, string>> {
        await this.dataReady;
        return this.designDocs;
    }

    onRefresh(callback: () => void): () => void {
        this.refreshListeners.add(callback);
        return () => this.refreshListeners.delete(callback);
    }

    /**
     * Subscribe to watched paths restoration.
     * Called when persisted watched paths are loaded from disk.
     */
    onWatchedPathsRestored(callback: (paths: string[]) => void): () => void {
        this.watchedPathsListeners.add(callback);
        return () => this.watchedPathsListeners.delete(callback);
    }

    /**
     * Load nodes and edges for a specific folder on-demand.
     */
    async loadFolderNodes(folderPath: string): Promise<{ nodes: VisNode[]; edges: VisEdge[] } | null> {
        return new Promise((resolve, reject) => {
            this.pendingFolderNodeRequests.set(folderPath, { resolve, reject });
            this.vscode.postMessage({
                command: 'loadFolderNodes',
                folderPath
            });

            // Timeout after 30 seconds
            setTimeout(() => {
                if (this.pendingFolderNodeRequests.has(folderPath)) {
                    this.pendingFolderNodeRequests.delete(folderPath);
                    reject(new Error(`Timeout loading nodes for ${folderPath}`));
                }
            }, 30000);
        });
    }

    getVscodeApi(): any {
        return this.vscode;
    }
}
