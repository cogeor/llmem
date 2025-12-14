import * as vscode from 'vscode';
import * as path from 'path';
import { HotReloadService } from './hot-reload';
import { getConfig } from './config';
import { WebviewDataService } from '../webview/data-service';

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
        switch (message.command) {
            case 'webview:ready':
                await this._startHotReloadAndSendInitialData();
                break;
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

        // Send initial data
        try {
            console.log('[LLMemPanel] Collecting initial data...');
            const data = await WebviewDataService.collectData(workspaceRoot, artifactRoot);
            this._panel.webview.postMessage({
                type: 'data:init',
                data: data
            });
            console.log('[LLMemPanel] Initial data sent');
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
