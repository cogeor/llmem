
import { DataProvider, HostKind, WatchToggleResult } from './dataProvider';
import { GraphData, WorkTreeNode, VisNode, VisEdge, DesignDoc } from '../types';
import { WebviewLogger, createWebviewLogger } from './webview-logger';
import type { FolderTreeData } from '../../../contracts/folder-tree';
import type { FolderEdgelistData } from '../../../contracts/folder-edges';
import { VsCodeWebviewApi, generateRequestId } from './vscodeDataProvider/request-id';
import {
    routeMessage,
    PendingFolderNodeRequest,
    PendingWatchToggle,
    PendingFolderTreeRequest,
    PendingFolderEdgesRequest,
} from './vscodeDataProvider/message-router';

declare const acquireVsCodeApi: () => VsCodeWebviewApi;

/**
 * DataProvider for VS Code webview mode.
 * Receives data from the extension host via postMessage.
 */
export class VSCodeDataProvider implements DataProvider {
    public readonly hostKind: HostKind = 'vscode';

    private vscode: VsCodeWebviewApi;
    private refreshListeners: Set<() => void> = new Set();
    private watchedPathsListeners: Set<(paths: string[]) => void> = new Set();
    private cachedWatchedPaths: string[] | null = null;
    private logger: WebviewLogger;

    // Cached data from extension
    private graphData: GraphData | null = null;
    private workTree: WorkTreeNode | null = null;
    private designDocs: Record<string, DesignDoc> = {};

    // Promise for initial data load
    private dataReady: Promise<void>;
    private resolveDataReady!: () => void;

    // Pending folder node requests
    private pendingFolderNodeRequests: Map<string, PendingFolderNodeRequest> = new Map();

    /**
     * Pending watch toggle requests, keyed by `requestId`. Loop 14 split
     * the previous single-slot field into a Map so two concurrent toggles
     * (e.g. user clicks on a folder while another file's toggle is still
     * in flight) resolve to their own results rather than the second one
     * overwriting the first. The extension echoes the requestId back in
     * `state:watchedPaths` (see `panel.ts::_handleToggleWatch`).
     */
    private pendingWatchToggles: Map<string, PendingWatchToggle> = new Map();

    /**
     * Pending folder-tree load requests, keyed by `requestId`. Loop 13.
     *
     * Mirrors `pendingWatchToggles`. Each call to `loadFolderTree()`
     * generates a unique requestId and stores its resolver here.
     * Panel-side handler in `src/extension/panel.ts::_loadFolderTree`
     * reads `.artifacts/folder-tree.json` via `FolderTreeStore` and
     * echoes `data:folderTree` (loop 02).
     */
    private pendingFolderTreeRequests: Map<string, PendingFolderTreeRequest> = new Map();

    private pendingFolderEdgesRequests: Map<string, PendingFolderEdgesRequest> = new Map();

    /**
     * Loop 14: `logger` is optional so existing test stubs that construct
     * `new VSCodeDataProvider()` keep working. Default behavior matches
     * `window.LLMEM_DEBUG` unset — silent for log/debug, console for warn/error.
     */
    constructor(logger?: WebviewLogger) {
        this.logger = logger ?? createWebviewLogger({ enabled: false });
        this.vscode = acquireVsCodeApi();
        this.dataReady = new Promise(resolve => {
            this.resolveDataReady = resolve;
        });

        window.addEventListener('message', (event) => this.handleMessage(event.data));

        // Signal ready to extension - it will send initial data
        this.vscode.postMessage({ command: 'webview:ready' });
    }

    /**
     * Dispatch an inbound extension message. The dispatch body lives in
     * the pure `message-router` sibling (Loop 22 split); this method just
     * threads the provider's mutable state in.
     */
    private handleMessage(message: any) {
        routeMessage(message, {
            logger: this.logger,
            refreshListeners: this.refreshListeners,
            watchedPathsListeners: this.watchedPathsListeners,
            pendingFolderNodeRequests: this.pendingFolderNodeRequests,
            pendingWatchToggles: this.pendingWatchToggles,
            pendingFolderTreeRequests: this.pendingFolderTreeRequests,
            pendingFolderEdgesRequests: this.pendingFolderEdgesRequests,
            setGraphData: (d) => { this.graphData = d; },
            setWorkTree: (t) => { this.workTree = t; },
            setDesignDocs: (docs) => { this.designDocs = docs; },
            setCachedWatchedPaths: (p) => { this.cachedWatchedPaths = p; },
            resolveDataReady: () => this.resolveDataReady(),
        });
    }

    async loadGraphData(): Promise<GraphData> {
        await this.dataReady;
        return this.graphData!;
    }

    async loadWorkTree(): Promise<WorkTreeNode> {
        await this.dataReady;
        return this.workTree!;
    }

    async loadDesignDocs(): Promise<Record<string, DesignDoc>> {
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
        // If paths already received, call immediately
        if (this.cachedWatchedPaths !== null) {
            callback(this.cachedWatchedPaths);
        }
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

    /**
     * Load the folder-tree artifact via the extension host. Loop 13.
     *
     * Posts a `loadFolderTree` request; the panel-side handler at
     * `src/extension/panel.ts::_loadFolderTree` echoes `data:folderTree`
     * with the matching `requestId` (loop 02).
     */
    async loadFolderTree(): Promise<FolderTreeData> {
        return new Promise((resolve, reject) => {
            const requestId = generateRequestId();

            const timeoutHandle = setTimeout(() => {
                if (this.pendingFolderTreeRequests.has(requestId)) {
                    this.pendingFolderTreeRequests.delete(requestId);
                    reject(new Error(
                        '[VSCodeDataProvider] loadFolderTree: timeout waiting for panel response after 30s',
                    ));
                }
            }, 30000);

            this.pendingFolderTreeRequests.set(requestId, { resolve, reject, timeoutHandle });

            this.vscode.postMessage({
                type: 'loadFolderTree',
                requestId,
            });
        });
    }

    /**
     * Load the folder-edgelist artifact via the extension host. Loop 13.
     *
     * Same wiring posture as `loadFolderTree()`: posts a
     * `loadFolderEdges` request; panel-side handler at
     * `src/extension/panel.ts::_loadFolderEdges` echoes `data:folderEdges`
     * with the matching `requestId` (loop 02).
     */
    async loadFolderEdges(): Promise<FolderEdgelistData> {
        return new Promise((resolve, reject) => {
            const requestId = generateRequestId();

            const timeoutHandle = setTimeout(() => {
                if (this.pendingFolderEdgesRequests.has(requestId)) {
                    this.pendingFolderEdgesRequests.delete(requestId);
                    reject(new Error(
                        '[VSCodeDataProvider] loadFolderEdges: timeout waiting for panel response after 30s',
                    ));
                }
            }, 30000);

            this.pendingFolderEdgesRequests.set(requestId, { resolve, reject, timeoutHandle });

            this.vscode.postMessage({
                type: 'loadFolderEdges',
                requestId,
            });
        });
    }

    /**
     * Toggle watch state for a path (file or folder).
     *
     * Loop 14: each call generates a unique `requestId`, stores its
     * resolver in `pendingWatchToggles`, and posts the id alongside the
     * toggle message. The extension echoes the id back in the
     * corresponding `state:watchedPaths` response so concurrent toggles
     * resolve to their own results.
     */
    async toggleWatch(path: string, watched: boolean): Promise<WatchToggleResult> {
        return new Promise((resolve, reject) => {
            const requestId = generateRequestId();

            const timeoutHandle = setTimeout(() => {
                if (this.pendingWatchToggles.has(requestId)) {
                    this.pendingWatchToggles.delete(requestId);
                    reject(new Error(`Timeout toggling watch for ${path}`));
                }
            }, 30000);

            this.pendingWatchToggles.set(requestId, { resolve, reject, timeoutHandle });

            this.vscode.postMessage({
                type: 'toggleWatch',
                requestId,
                path,
                watched,
            });
        });
    }

    /**
     * Ask the extension host to reveal a range in the editor.
     */
    revealRange(filePath: string, line: number): void {
        this.vscode.postMessage({ command: 'revealRange', path: filePath, line });
    }

    /**
     * Ask the extension host to open a URL externally.
     */
    openExternal(url: string): void {
        this.vscode.postMessage({ command: 'openExternal', url });
    }
}
