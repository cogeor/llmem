import * as vscode from 'vscode';
import * as path from 'path';
import { HotReloadService } from './hot-reload';
import { getConfig } from './config';
import { collectViewerData, type ViewerData } from '../application/viewer-data';
import { scanFile, scanFolderRecursive } from '../application/scan';
import { addWatchedPath, removeWatchedPath } from '../application/toggle-watch';
import type { Logger } from '../core/logger';
import { asWorkspaceRoot, asAbsPath, asRelPath } from '../core/paths';
import { parseGraphId } from '../core/ids';
import type { DesignDoc } from '../webview/design-docs';

/**
 * Renderer shape produced from a `ViewerData`'s raw markdown by the panel
 * before posting to the webview. The viewer expects the legacy
 * `Record<string, DesignDoc>` shape, where each value carries both the
 * markdown source and the rendered HTML.
 */
interface ViewerDataRendered {
    graphData: ViewerData['graphData'];
    workTree: ViewerData['workTree'];
    designDocs: Record<string, DesignDoc>;
}

/**
 * Render raw markdown into the legacy `DesignDoc` shape using `marked`.
 *
 * Application-layer `collectViewerData` returns raw markdown only; the
 * panel renders here so presentation stays out of the application layer.
 * (Loop 06 deliberate split.) Consolidating with `webview/design-docs.ts`
 * is Loop 12 territory.
 *
 * Uses dynamic import for ESM-only `marked` — same workaround
 * `DesignDocManager.getAllDocsAsync` uses.
 */
async function renderViewerDocs(raw: Record<string, string>): Promise<Record<string, DesignDoc>> {
    const out: Record<string, DesignDoc> = {};
    const dynamicImport = new Function('specifier', 'return import(specifier)');
    let marked: any;
    try {
        const mod = await dynamicImport('marked');
        marked = mod.marked;
    } catch (e) {
        console.error('[LLMemPanel] Failed to import marked:', e);
        return out;
    }
    for (const [key, markdown] of Object.entries(raw)) {
        try {
            const html = await marked.parse(markdown);
            out[key] = { markdown, html };
        } catch (e) {
            console.error(`[LLMemPanel] Failed to render design doc: ${key}`, e);
        }
    }
    return out;
}

/** Compose a rendered viewer payload for posting to the webview. */
async function toRenderedViewerData(data: ViewerData): Promise<ViewerDataRendered> {
    return {
        graphData: data.graphData,
        workTree: data.workTree,
        designDocs: await renderViewerDocs(data.designDocs),
    };
}

/**
 * Manages the LLMem Webview Panel
 * 
 * Serves the bundled webview UI from dist/webview/ and integrates with
 * HotReloadService to push data updates when files change.
 */
export class LLMemPanel {
    public static currentPanel: LLMemPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _hotReload: HotReloadService | undefined;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._panel.webview.html = this._getHtmlForWebview();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            msg => this._handleMessage(msg),
            null,
            this._disposables
        );
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor?.viewColumn;

        if (LLMemPanel.currentPanel) {
            LLMemPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'llmemPanel',
            'LLMem',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'dist', 'webview')
                ]
            }
        );

        LLMemPanel.currentPanel = new LLMemPanel(panel, extensionUri);
    }

    private _getHtmlForWebview(): string {
        const webview = this._panel.webview;
        const distWebview = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview');
        const distStyles = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'styles');

        // Asset URIs
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distWebview, 'main.js'));
        const baseStyle = webview.asWebviewUri(vscode.Uri.joinPath(distStyles, 'base.css'));
        const layoutStyle = webview.asWebviewUri(vscode.Uri.joinPath(distStyles, 'layout.css'));
        const treeStyle = webview.asWebviewUri(vscode.Uri.joinPath(distStyles, 'tree.css'));
        const detailStyle = webview.asWebviewUri(vscode.Uri.joinPath(distStyles, 'detail.css'));
        const graphStyle = webview.asWebviewUri(vscode.Uri.joinPath(distStyles, 'graph.css'));

        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="
        default-src 'none';
        style-src ${webview.cspSource} 'unsafe-inline';
        script-src 'nonce-${nonce}';
        font-src ${webview.cspSource};
        img-src ${webview.cspSource} https: data:;
    ">
    <link rel="stylesheet" href="${baseStyle}">
    <link rel="stylesheet" href="${layoutStyle}">
    <link rel="stylesheet" href="${treeStyle}">
    <link rel="stylesheet" href="${detailStyle}">
    <link rel="stylesheet" href="${graphStyle}">
    <title>LLMem</title>
</head>
<body>
    <div id="app" class="layout-row">
        <div id="explorer-pane" class="pane" style="width: 250px;">
            <div class="pane-header">
                <span class="pane-title">Explorer</span>
                <div class="toolbar">
                    <button id="theme-toggle" class="icon-btn" title="Toggle Theme">☀️</button>
                </div>
            </div>
            <div class="pane-content" id="worktree-root"></div>
        </div>
        <div class="splitter" id="splitter-1"></div>
        <div id="design-pane" class="pane" style="flex: 1;">
            <div class="pane-header">
                <span class="pane-title">Design</span>
                <div class="toolbar"><div id="view-toggle" style="display:none"></div></div>
            </div>
            <div class="pane-content">
                <div id="design-view" class="detail-view"></div>
            </div>
        </div>
        <div class="splitter" id="splitter-2"></div>
        <div id="graph-pane" class="pane" style="flex: 1;">
            <div class="pane-header">
                <span class="pane-title">Graph</span>
                <div class="toolbar"><div id="graph-type-toggle"></div></div>
            </div>
            <div class="pane-content graph-pane-content">
                <div id="graph-view" class="graph-container">
                    <div class="graph-canvas"></div>
                </div>
            </div>
        </div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private async _handleMessage(message: any) {
        switch (message.command || message.type) {
            case 'webview:ready':
                await this._startHotReloadAndSendInitialData();
                break;
            case 'loadFolderNodes':
                await this._loadFolderNodes(message.folderPath);
                break;
            case 'toggleWatch':
                await this._handleToggleWatch(message.path, message.watched);
                break;
        }
    }

    /**
     * Load nodes and edges for a folder on-demand (lazy loading).
     */
    private async _loadFolderNodes(folderPath: string) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            this._panel.webview.postMessage({
                type: 'data:folderNodes',
                folderPath,
                error: 'No workspace folder open'
            });
            return;
        }

        const config = getConfig();
        const artifactRoot = path.join(workspaceRoot, config.artifactRoot);

        console.log(`[LLMemPanel] Loading nodes for folder: ${folderPath}`);

        try {
            // Generate edges for the folder (this also creates nodes)
            const result = await scanFolderRecursive({
                workspaceRoot: asWorkspaceRoot(workspaceRoot),
                folderPath,
                artifactDir: artifactRoot,
                logger: this._panelLogger(),
            });

            // Load the updated edge lists to get the new nodes and edges
            const { CallEdgeListStore } = await import('../graph/edgelist');
            const callStore = new CallEdgeListStore(artifactRoot);
            await callStore.load();

            // Get nodes and edges for this folder. Use the graph-ID contract:
            // reduce each endpoint to its underlying file, then check folder
            // containment. The previous code's `+ ENTITY_SEPARATOR` clauses
            // were dead (folderPath cannot also be a file ID used as an
            // entity prefix); see src/core/ids.ts.
            const nodes = callStore.getNodesByFolder(folderPath);
            const fileFor = (graphId: string): string => {
                const parsed = parseGraphId(graphId);
                return parsed.kind === 'entity' ? parsed.fileId : graphId;
            };
            const isInFolder = (graphId: string): boolean => {
                const file = fileFor(graphId);
                return file === folderPath || file.startsWith(folderPath + '/');
            };
            const edges = callStore.getEdges().filter(e => isInFolder(e.source) || isInFolder(e.target));

            // Convert to VisNode/VisEdge format
            const visNodes = nodes.map(n => ({
                id: n.id,
                label: n.name,
                group: n.fileId,
                fileId: n.fileId
            }));

            const visEdges = edges.map(e => ({
                from: e.source,
                to: e.target
            }));

            console.log(`[LLMemPanel] Loaded ${visNodes.length} nodes, ${visEdges.length} edges for ${folderPath}`);

            this._panel.webview.postMessage({
                type: 'data:folderNodes',
                folderPath,
                data: {
                    nodes: visNodes,
                    edges: visEdges
                }
            });
        } catch (e: any) {
            console.error(`[LLMemPanel] Failed to load folder nodes:`, e);
            this._panel.webview.postMessage({
                type: 'data:folderNodes',
                folderPath,
                error: e.message
            });
        }
    }

    /**
     * Handle toggle-watch message. Loop 09 lifted the workflow into
     * `application/toggle-watch.ts`; this handler is a thin wrapper that
     * dispatches the result back to the webview and into hot-reload.
     */
    private async _handleToggleWatch(targetPath: string, watched: boolean) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) return;
        const artifactRoot = path.join(workspaceRoot, getConfig().artifactRoot);
        const req = {
            workspaceRoot: asWorkspaceRoot(workspaceRoot),
            artifactRoot: asAbsPath(artifactRoot),
            targetPath: asRelPath(targetPath),
            logger: this._panelLogger(),
        };
        console.log(`[LLMemPanel] Toggle watch: ${targetPath} -> ${watched}`);
        try {
            if (watched) {
                const result = await addWatchedPath(req);
                for (const f of result.addedFiles) this._hotReload?.addWatchedPath(f);
                this._panel.webview.postMessage({
                    type: 'state:watchedPaths',
                    paths: result.watchedFiles,
                    addedFiles: result.addedFiles,
                });
                if (!result.success && result.message) vscode.window.showWarningMessage(result.message);
            } else {
                const result = await removeWatchedPath(req);
                for (const f of result.removedFiles) this._hotReload?.removeWatchedPath(f);
                this._panel.webview.postMessage({
                    type: 'state:watchedPaths',
                    paths: result.watchedFiles,
                    removedFiles: result.removedFiles,
                });
            }
            const raw = await collectViewerData({
                workspaceRoot: req.workspaceRoot,
                artifactRoot: req.artifactRoot,
                logger: req.logger,
            });
            const rendered = await toRenderedViewerData(raw);
            this._panel.webview.postMessage({ type: 'data:refresh', data: rendered });
        } catch (e: any) {
            vscode.window.showErrorMessage(`Toggle watch failed: ${e?.message ?? String(e)}`);
        }
    }

    private async _startHotReloadAndSendInitialData() {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            console.error('[LLMemPanel] No workspace root');
            return;
        }

        const config = getConfig();
        const artifactRoot = path.join(workspaceRoot, config.artifactRoot);

        console.log('[LLMemPanel] Using WatchService with file-only tracking');

        // Load watch state using WatchService
        const { WatchService } = await import('../graph/worktree-state');
        const watchService = new WatchService(artifactRoot, workspaceRoot);
        await watchService.load();

        const watchedFiles = watchService.getWatchedFiles();
        console.log(`[LLMemPanel] Found ${watchedFiles.length} watched files`);

        // Detect changed files and regenerate edges
        if (watchedFiles.length > 0) {
            const changedFiles = await watchService.getChangedFiles();
            console.log(`[LLMemPanel] ${changedFiles.length} files have changed`);

            // Regenerate edges for changed files
            const logger = this._panelLogger();
            for (const filePath of changedFiles) {
                try {
                    await scanFile({
                        workspaceRoot: asWorkspaceRoot(workspaceRoot),
                        filePath,
                        artifactDir: artifactRoot,
                        logger,
                    });
                } catch (e) {
                    console.error(`[LLMemPanel] Failed to regenerate edges for ${filePath}:`, e);
                }
            }

            // Save updated hashes
            if (changedFiles.length > 0) {
                await watchService.save();
            }
        }

        // Start hot reload service
        this._hotReload = new HotReloadService(
            artifactRoot,
            workspaceRoot,
            (data) => {
                this._panel.webview.postMessage({
                    type: 'data:refresh',
                    data: data
                });
            }
        );

        this._hotReload.start();
        this._disposables.push({ dispose: () => this._hotReload?.stop() });

        // Add watched files to hot reload
        for (const f of watchedFiles) {
            this._hotReload.addWatchedPath(f);
        }

        // Send initial data
        try {
            console.log('[LLMemPanel] Collecting initial data...');
            const raw = await collectViewerData({
                workspaceRoot: asWorkspaceRoot(workspaceRoot),
                artifactRoot: asAbsPath(artifactRoot),
                logger: this._panelLogger(),
            });
            const rendered = await toRenderedViewerData(raw);
            this._panel.webview.postMessage({
                type: 'data:init',
                data: rendered
            });
            console.log('[LLMemPanel] Initial data sent:', {
                importNodes: rendered.graphData.importGraph.nodes.length,
                importEdges: rendered.graphData.importGraph.edges.length,
                callNodes: rendered.graphData.callGraph.nodes.length,
                callEdges: rendered.graphData.callGraph.edges.length
            });

            // Send watched files to webview
            if (watchedFiles.length > 0) {
                this._panel.webview.postMessage({
                    type: 'state:watchedPaths',
                    paths: watchedFiles
                });
                console.log(`[LLMemPanel] Sent ${watchedFiles.length} watched files to webview`);
            }
        } catch (e) {
            console.error('[LLMemPanel] Initial data load failed:', e);
            this._panel.webview.postMessage({
                type: 'data:init',
                data: {
                    graphData: { importGraph: { nodes: [], edges: [] }, callGraph: { nodes: [], edges: [] } },
                    workTree: { name: 'root', path: '', type: 'directory', children: [] },
                    designDocs: {}
                }
            });
        }
    }

    /**
     * Clear all edge lists (temporary behavior for clean slate on startup).
     */
    private async _clearAllEdgeLists(artifactRoot: string) {
        const { ImportEdgeListStore, CallEdgeListStore } = await import('../graph/edgelist');

        // Clear import edge list
        const importStore = new ImportEdgeListStore(artifactRoot);
        await importStore.load();
        importStore.clear();
        await importStore.save();

        // Clear call edge list
        const callStore = new CallEdgeListStore(artifactRoot);
        await callStore.load();
        callStore.clear();
        await callStore.save();

        console.log('[LLMemPanel] Cleared all edge lists on startup');
    }

    private _getNonce(): string {
        let text = '';
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return text;
    }

    /**
     * Build a Logger that bridges scan / viewer-data progress into the
     * existing panel-side console.log shape. Replacing console with an
     * OutputChannel is a future-loop concern (Phase-5 logging
     * unification); for now we preserve today's exact log strings.
     */
    private _panelLogger(): Logger {
        return {
            info: (m) => console.log(m),
            warn: (m) => console.warn(m),
            error: (m) => console.error(m),
        };
    }

    public dispose() {
        LLMemPanel.currentPanel = undefined;
        this._hotReload?.stop();
        this._panel.dispose();
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }
}
