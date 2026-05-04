
import { DataProvider, HostKind, WatchToggleResult } from './dataProvider';
import { GraphData, WorkTreeNode, VisNode, VisEdge, DesignDoc } from '../types';
import type { FolderTreeData } from '../../../graph/folder-tree';
import type { FolderEdgelistData } from '../../../graph/folder-edges';

/**
 * Minimal shape of the VS Code webview API. The full type lives in
 * `@types/vscode-webview`, but pulling it in here would force every
 * webview consumer to compile against `vscode` types — instead we keep a
 * structural alias and feed `acquireVsCodeApi()` (typed as the same shape)
 * straight into `this.vscode`. The result is privately stored: components
 * never see the raw API (Loop 14 / static review).
 */
interface VsCodeWebviewApi {
    postMessage(msg: unknown): void;
}

declare const acquireVsCodeApi: () => VsCodeWebviewApi;

/**
 * Generate a fresh request ID. We prefer `crypto.randomUUID()` because the
 * VS Code webview runtime, the static-mode browser bundle, and modern jsdom
 * all expose it. If it's unavailable (older jsdom in some test
 * environments) we fall back to a process-local counter so the keying
 * behaviour stays correct — uniqueness only has to hold within one
 * VSCodeDataProvider instance, not across processes.
 */
let nextRequestIdCounter = 0;
function generateRequestId(): string {
    const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (cryptoRef?.randomUUID) {
        return cryptoRef.randomUUID();
    }
    return `req-${++nextRequestIdCounter}`;
}

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

    // Cached data from extension
    private graphData: GraphData | null = null;
    private workTree: WorkTreeNode | null = null;
    private designDocs: Record<string, DesignDoc> = {};

    // Promise for initial data load
    private dataReady: Promise<void>;
    private resolveDataReady!: () => void;

    // Pending folder node requests
    private pendingFolderNodeRequests: Map<string, {
        resolve: (data: { nodes: VisNode[]; edges: VisEdge[] } | null) => void;
        reject: (error: Error) => void;
    }> = new Map();

    /**
     * Pending watch toggle requests, keyed by `requestId`. Loop 14 split
     * the previous single-slot field into a Map so two concurrent toggles
     * (e.g. user clicks on a folder while another file's toggle is still
     * in flight) resolve to their own results rather than the second one
     * overwriting the first. The extension echoes the requestId back in
     * `state:watchedPaths` (see `panel.ts::_handleToggleWatch`).
     */
    private pendingWatchToggles: Map<string, {
        resolve: (result: WatchToggleResult) => void;
        reject: (error: Error) => void;
        timeoutHandle: ReturnType<typeof setTimeout>;
    }> = new Map();

    /**
     * Pending folder-tree load requests, keyed by `requestId`. Loop 13.
     *
     * Mirrors `pendingWatchToggles`. Each call to `loadFolderTree()`
     * generates a unique requestId and stores its resolver here. The
     * extension host is expected to echo the requestId back in a
     * `data:folderTree` message — but **this handler does not exist
     * yet** (`src/extension/` off-limits this loop). The 30s timeout
     * fires the rejection so VS Code consumers see a clear error.
     */
    private pendingFolderTreeRequests: Map<string, {
        resolve: (data: FolderTreeData) => void;
        reject: (error: Error) => void;
        timeoutHandle: ReturnType<typeof setTimeout>;
    }> = new Map();

    private pendingFolderEdgesRequests: Map<string, {
        resolve: (data: FolderEdgelistData) => void;
        reject: (error: Error) => void;
        timeoutHandle: ReturnType<typeof setTimeout>;
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

            case 'state:watchedPaths': {
                // The same message arrives in two flows:
                //   (a) initial restore — extension pushes persisted watched
                //       paths on `webview:ready` with no `requestId`;
                //   (b) toggle response — extension echoes the `requestId`
                //       we supplied in `toggleWatch` so we can resolve the
                //       right pending promise (Loop 14 — see comment on
                //       `pendingWatchToggles`).
                console.log(`[VSCodeDataProvider] Received ${message.paths?.length || 0} watched paths`);
                this.cachedWatchedPaths = message.paths || [];
                this.watchedPathsListeners.forEach(cb => cb(message.paths || []));

                const requestId: unknown = message.requestId;
                if (typeof requestId === 'string' && this.pendingWatchToggles.has(requestId)) {
                    const entry = this.pendingWatchToggles.get(requestId)!;
                    clearTimeout(entry.timeoutHandle);
                    this.pendingWatchToggles.delete(requestId);
                    entry.resolve({
                        success: true,
                        addedFiles: message.addedFiles,
                        removedFiles: message.removedFiles,
                    });
                } else if (typeof requestId === 'undefined' && this.pendingWatchToggles.size > 0) {
                    // Legacy fallback: an older extension host that does not
                    // yet echo `requestId`. Resolve the oldest pending entry
                    // so toggles still complete; once the extension is
                    // updated this branch becomes unreachable.
                    const oldestKey = this.pendingWatchToggles.keys().next().value;
                    if (oldestKey !== undefined) {
                        const entry = this.pendingWatchToggles.get(oldestKey)!;
                        clearTimeout(entry.timeoutHandle);
                        this.pendingWatchToggles.delete(oldestKey);
                        entry.resolve({
                            success: true,
                            addedFiles: message.addedFiles,
                            removedFiles: message.removedFiles,
                        });
                    }
                }
                // If `requestId` is present but unknown, the response is
                // either stale (already timed out) or for a different
                // provider instance. Drop it silently.
                break;
            }

            case 'data:folderTree': {
                const requestId: unknown = message.requestId;
                if (typeof requestId !== 'string') break;
                const pending = this.pendingFolderTreeRequests.get(requestId);
                if (!pending) break;
                clearTimeout(pending.timeoutHandle);
                this.pendingFolderTreeRequests.delete(requestId);
                if (message.error) {
                    pending.reject(new Error(String(message.error)));
                } else {
                    pending.resolve(message.data as FolderTreeData);
                }
                break;
            }

            case 'data:folderEdges': {
                const requestId: unknown = message.requestId;
                if (typeof requestId !== 'string') break;
                const pending = this.pendingFolderEdgesRequests.get(requestId);
                if (!pending) break;
                clearTimeout(pending.timeoutHandle);
                this.pendingFolderEdgesRequests.delete(requestId);
                if (message.error) {
                    pending.reject(new Error(String(message.error)));
                } else {
                    pending.resolve(message.data as FolderEdgelistData);
                }
                break;
            }
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
     * **NOTE: panel-side handler not yet wired.** `src/extension/` was
     * off-limits in loop 13, so this method posts a correctly-typed
     * `loadFolderTree` request and registers a pending entry — but no
     * extension-host code listens for it today. The future loop that
     * lands the handler in `src/extension/panel.ts` must:
     *   1. handle `case 'loadFolderTree':` in the panel's message switch;
     *   2. read `.artifacts/folder-tree.json` (or call into
     *      `application/viewer-data.ts`); and
     *   3. post back `{ type: 'data:folderTree', requestId, data }` (or
     *      `{ ..., error }`) using the same requestId.
     * Until that lands, calls reject after the 30s timeout with an
     * explicit "not yet wired" message.
     */
    async loadFolderTree(): Promise<FolderTreeData> {
        return new Promise((resolve, reject) => {
            const requestId = generateRequestId();

            const timeoutHandle = setTimeout(() => {
                if (this.pendingFolderTreeRequests.has(requestId)) {
                    this.pendingFolderTreeRequests.delete(requestId);
                    reject(new Error(
                        '[VSCodeDataProvider] loadFolderTree: not yet wired in extension host. ' +
                        'The panel-side `data:folderTree` handler in `src/extension/panel.ts` ' +
                        'is missing (loop 13 left this gap intentionally — see PLAN.md).',
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
     * `loadFolderEdges` request, expects a future panel-side handler to
     * echo back `data:folderEdges` with the same requestId. No handler
     * exists today (`src/extension/` off-limits in loop 13).
     */
    async loadFolderEdges(): Promise<FolderEdgelistData> {
        return new Promise((resolve, reject) => {
            const requestId = generateRequestId();

            const timeoutHandle = setTimeout(() => {
                if (this.pendingFolderEdgesRequests.has(requestId)) {
                    this.pendingFolderEdgesRequests.delete(requestId);
                    reject(new Error(
                        '[VSCodeDataProvider] loadFolderEdges: not yet wired in extension host. ' +
                        'The panel-side `data:folderEdges` handler in `src/extension/panel.ts` ' +
                        'is missing (loop 13 left this gap intentionally — see PLAN.md).',
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
