
import { DataProvider } from './dataProvider';
import { GraphData, WorkTreeNode } from '../types';

declare const acquireVsCodeApi: () => any;

/**
 * DataProvider for VS Code webview mode.
 * Receives data from the extension host via postMessage.
 */
export class VSCodeDataProvider implements DataProvider {
    private vscode: any;
    private refreshListeners: Set<() => void> = new Set();

    // Cached data from extension
    private graphData: GraphData | null = null;
    private workTree: WorkTreeNode | null = null;
    private designDocs: Record<string, string> = {};

    // Promise for initial data load
    private dataReady: Promise<void>;
    private resolveDataReady!: () => void;

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

    getVscodeApi(): any {
        return this.vscode;
    }
}
