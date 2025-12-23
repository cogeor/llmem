import * as vscode from 'vscode';
import * as path from 'path';
import { HotReloadService } from './hot-reload';
import { getConfig } from './config';
import { WebviewDataService } from '../webview/data-service';
import { generateCallEdgesForFolderRecursive } from '../scripts/generate-call-edges';

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
                    vscode.Uri.joinPath(extensionUri, 'dist', 'webview'),
                    vscode.Uri.joinPath(extensionUri, 'src', 'webview', 'styles')
                ]
            }
        );

        LLMemPanel.currentPanel = new LLMemPanel(panel, extensionUri);
    }

    private _getHtmlForWebview(): string {
        const webview = this._panel.webview;
        const distWebview = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview');
        const srcStyles = vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'styles');

        // Asset URIs
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distWebview, 'main.js'));
        const baseStyle = webview.asWebviewUri(vscode.Uri.joinPath(srcStyles, 'base.css'));
        const layoutStyle = webview.asWebviewUri(vscode.Uri.joinPath(srcStyles, 'layout.css'));
        const treeStyle = webview.asWebviewUri(vscode.Uri.joinPath(srcStyles, 'tree.css'));
        const detailStyle = webview.asWebviewUri(vscode.Uri.joinPath(srcStyles, 'detail.css'));
        const graphStyle = webview.asWebviewUri(vscode.Uri.joinPath(srcStyles, 'graph.css'));

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
            case 'regenerateEdges':
                await this._regenerateEdges(message.path);
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
            const result = await generateCallEdgesForFolderRecursive(workspaceRoot, folderPath, artifactRoot);

            // Load the updated edge lists to get the new nodes and edges
            const { CallEdgeListStore } = await import('../graph/edgelist');
            const callStore = new CallEdgeListStore(artifactRoot);
            await callStore.load();

            // Get nodes and edges for this folder
            const nodes = callStore.getNodesByFolder(folderPath);
            const edges = callStore.getEdges().filter(e =>
                e.source.startsWith(folderPath + '/') ||
                e.source.startsWith(folderPath + '::') ||
                e.target.startsWith(folderPath + '/') ||
                e.target.startsWith(folderPath + '::')
            );

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
     * Regenerate edges for a specific path (file or folder) and refresh the webview data.
     */
    private async _regenerateEdges(targetPath: string) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        const config = getConfig();
        const artifactRoot = path.join(workspaceRoot, config.artifactRoot);
        const absolutePath = path.join(workspaceRoot, targetPath);

        // Detect if path is file or folder
        const fs = require('fs');
        const isFile = fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();

        console.log(`[LLMemPanel] Regenerating edges for: ${targetPath} (isFile: ${isFile})`);
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Generating edges for ${targetPath}...`,
            cancellable: false
        }, async () => {
            try {
                let result;
                if (isFile) {
                    // Import the file function dynamically to avoid circular deps
                    const { generateCallEdgesForFile } = await import('../scripts/generate-call-edges');
                    result = await generateCallEdgesForFile(workspaceRoot, targetPath, artifactRoot);
                } else {
                    result = await generateCallEdgesForFolderRecursive(workspaceRoot, targetPath, artifactRoot);
                }
                vscode.window.showInformationMessage(`Added ${result.newEdges} new edges. Total: ${result.totalEdges}`);

                // Refresh webview data
                const data = await WebviewDataService.collectData(workspaceRoot, artifactRoot);
                this._panel.webview.postMessage({
                    type: 'data:refresh',
                    data: data
                });
            } catch (e: any) {
                vscode.window.showErrorMessage(`Failed to generate edges: ${e.message}`);
            }
        });
    }

    /**
     * Handle toggle watch message - manage watched files using WatchService.
     */
    private async _handleToggleWatch(targetPath: string, watched: boolean) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            return;
        }

        const config = getConfig();
        const artifactRoot = path.join(workspaceRoot, config.artifactRoot);
        const fs = require('fs');

        console.log(`[LLMemPanel] Toggle watch: ${targetPath} -> ${watched}`);

        // Use centralized WatchService
        const { WatchService } = await import('../graph/worktree-state');
        const watchService = new WatchService(artifactRoot, workspaceRoot);
        await watchService.load();

        const absolutePath = path.join(workspaceRoot, targetPath);
        const isDir = fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory();

        if (watched) {
            // When turning ON: add files and regenerate edges
            let addedFiles: string[];
            if (isDir) {
                addedFiles = await watchService.addFolder(targetPath);
            } else {
                await watchService.addFile(targetPath);
                addedFiles = [targetPath];
            }

            // Add files to hot reload
            for (const f of addedFiles) {
                this._hotReload?.addWatchedPath(f);
            }

            // Regenerate edges
            await this._regenerateEdges(targetPath);
            await watchService.save();

            // Send updated watched files to webview (include addedFiles for UI state update)
            this._panel.webview.postMessage({
                type: 'state:watchedPaths',
                paths: watchService.getWatchedFiles(),
                addedFiles: addedFiles
            });

            console.log(`[LLMemPanel] Added ${addedFiles.length} files to watch`);
        } else {
            // When turning OFF: remove files
            let removedFiles: string[];
            if (isDir) {
                removedFiles = watchService.removeFolder(targetPath);
            } else {
                watchService.removeFile(targetPath);
                removedFiles = [targetPath];
            }

            // Remove from hot reload
            for (const f of removedFiles) {
                this._hotReload?.removeWatchedPath(f);
            }

            // Delete edges
            await this._deleteEdgesForPath(targetPath, artifactRoot);
            await watchService.save();

            // Send updated watched files to webview (include removedFiles for UI state update)
            this._panel.webview.postMessage({
                type: 'state:watchedPaths',
                paths: watchService.getWatchedFiles(),
                removedFiles: removedFiles
            });

            // Refresh webview data
            const data = await WebviewDataService.collectData(workspaceRoot, artifactRoot);
            this._panel.webview.postMessage({
                type: 'data:refresh',
                data: data
            });

            console.log(`[LLMemPanel] Removed ${removedFiles.length} files from watch`);
        }
    }

    /**
     * Delete edges for a given path from both import and call edge lists.
     */
    private async _deleteEdgesForPath(targetPath: string, artifactRoot: string) {
        const { ImportEdgeListStore, CallEdgeListStore } = await import('../graph/edgelist');

        // Delete from import edge list
        const importStore = new ImportEdgeListStore(artifactRoot);
        await importStore.load();
        importStore.removeByFolder(targetPath);
        await importStore.save();

        // Delete from call edge list
        const callStore = new CallEdgeListStore(artifactRoot);
        await callStore.load();
        callStore.removeByFolder(targetPath);
        await callStore.save();

        console.log(`[LLMemPanel] Deleted edges for: ${targetPath}`);
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
            const { generateCallEdgesForFile } = await import('../scripts/generate-call-edges');
            for (const filePath of changedFiles) {
                try {
                    await generateCallEdgesForFile(workspaceRoot, filePath, artifactRoot);
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
            const data = await WebviewDataService.collectData(workspaceRoot, artifactRoot);
            this._panel.webview.postMessage({
                type: 'data:init',
                data: data
            });
            console.log('[LLMemPanel] Initial data sent:', {
                importNodes: data.graphData.importGraph.nodes.length,
                importEdges: data.graphData.importGraph.edges.length,
                callNodes: data.graphData.callGraph.nodes.length,
                callEdges: data.graphData.callGraph.edges.length
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

    public dispose() {
        LLMemPanel.currentPanel = undefined;
        this._hotReload?.stop();
        this._panel.dispose();
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }
}
