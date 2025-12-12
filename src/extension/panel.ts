import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ensureArtifacts } from '../artifact/service';
import { buildGraphs } from '../graph';
import { Config, getConfig } from './config';

/**
 * Manages the LLMem Webview Panel
 */
export class LLMemPanel {
    public static currentPanel: LLMemPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programmatically
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'webview:ready':
                        this._attemptInitialLoad();
                        return;
                    case 'action:generate_context':
                        this._generateContext();
                        return;
                    case 'chat:send':
                        this._handleChat(message.text);
                        return;
                    case 'action:switch_graph':
                        // TODO: Implement switching between graphs (cached)
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it.
        if (LLMemPanel.currentPanel) {
            LLMemPanel.currentPanel._panel.reveal(column);
            return;
        }

        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(
            'llmemPanel',
            'LLMem Context',
            column || vscode.ViewColumn.One,
            {
                // Enable javascript in the webview
                enableScripts: true,
                // And restrict the webview to only loading content from our extension's `src/webview` directory.
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'src', 'webview')]
            }
        );

        LLMemPanel.currentPanel = new LLMemPanel(panel, extensionUri);
    }

    public dispose() {
        LLMemPanel.currentPanel = undefined;

        // Clean up our resources
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Local path to main script run in the webview
        const scriptPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'main.js');
        const scriptUri = webview.asWebviewUri(scriptPathOnDisk);

        // Local path to css styles
        const stylePathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'style.css');
        const styleUri = webview.asWebviewUri(stylePathOnDisk);

        // Local path to vis-network
        const visPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'libs', 'vis-network.min.js');
        const visUri = webview.asWebviewUri(visPathOnDisk);

        // Read the HTML file from disk
        const htmlPath = path.join(this._extensionUri.fsPath, 'src', 'webview', 'index.html');
        let htmlInfo = '';
        try {
            htmlInfo = fs.readFileSync(htmlPath, 'utf8');
        } catch (e) {
            htmlInfo = `<html><body>Error loading html: ${e}<br/>Path: ${htmlPath}</body></html>`;
        }

        // Inject URIs
        // We replace the script/css tags with our webview URIs
        // Note: Simple string replacement for now.

        let html = htmlInfo
            .replace('src="main.js"', `src="${scriptUri}"`)
            .replace('href="style.css"', `href="${styleUri}"`)
            .replace('src="libs/vis-network.min.js"', `src="${visUri}"`);

        return html;
    }

    private async _generateContext() {
        this._postMessage({ type: 'status:update', status: 'working', message: 'Generating artifacts...' });

        try {
            const config = getConfig();
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

            if (!workspaceRoot) {
                throw new Error('No workspace open');
            }

            // We assume ArtifactService is initialized by the extension.ts on activation.
            // If the user hasn't opened a workspace, we caught it above.

            // 1. Artifacts
            // Recursively ensure artifacts for the current workspace
            await ensureArtifacts('.', true);

            this._postMessage({ type: 'status:update', status: 'working', message: 'Building graph...' });

            // 2. Build Graphs
            const { importGraph, callGraph } = await buildGraphs(config.artifactRoot);

            // 3. Send Data (Import Graph by default)
            const visData = this._convertGraphToVis(importGraph);

            this._postMessage({ type: 'plot:data', data: visData });
            this._postMessage({ type: 'status:update', status: 'idle', message: 'Context updated' });

        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this._postMessage({ type: 'status:update', status: 'idle', message: `Error: ${msg}` });
            vscode.window.showErrorMessage(`Context Generation Failed: ${msg}`);
        }
    }

    private async _attemptInitialLoad() {
        try {
            const config = getConfig();
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

            if (!workspaceRoot) {
                return; // No workspace, nothing to load.
            }

            const artifactDir = path.join(workspaceRoot, config.artifactRoot);

            // simple check if directory exists and is not empty
            if (!fs.existsSync(artifactDir)) {
                return; // No artifacts, wait for user to generate.
            }

            // Optional: check if directory has files before trying
            // but buildGraphs handles partial data gracefully (empty arrays)

            this._postMessage({ type: 'status:update', status: 'working', message: 'Loading existing context...' });

            const { importGraph } = await buildGraphs(config.artifactRoot);

            // Only send if we actually got something
            if (importGraph.nodes.size > 0) {
                const visData = this._convertGraphToVis(importGraph);
                this._postMessage({ type: 'plot:data', data: visData });
                this._postMessage({ type: 'status:update', status: 'idle', message: 'Context loaded' });
            } else {
                this._postMessage({ type: 'status:update', status: 'idle', message: 'No nodes found in artifacts' });
            }

        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error('Initial load failed:', msg);
            // Don't show error toast on initial load, just update status
            this._postMessage({ type: 'status:update', status: 'idle', message: 'Ready' });
        }
    }

    private _convertGraphToVis(graph: any) {
        // Simple conversion
        const nodes = Array.from(graph.nodes.values()).map((n: any) => ({
            id: n.id,
            label: n.label,
            group: n.kind || 'default',
            title: n.label // Tooltip
        }));

        const edges = graph.edges.map((e: any) => ({
            from: e.source,
            to: e.target
        }));

        return { nodes, edges };
    }

    private _handleChat(text: string) {
        // Placeholder for Antigravity Agent integration
        setTimeout(() => {
            this._postMessage({
                type: 'chat:append',
                role: 'assistant',
                content: `I received your message: "${text}". Real agent integration is coming next.`
            });
        }, 500);
    }

    private _postMessage(message: any) {
        this._panel.webview.postMessage(message);
    }
}
