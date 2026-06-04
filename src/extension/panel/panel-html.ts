/**
 * Panel HTML / shell rendering (Loop 15 split).
 *
 * Carved verbatim from the former `panel.ts` monolith: the webview HTML
 * construction (`_getHtmlForWebview`) and the per-render nonce generator
 * (`_getNonce`). Extracted as free functions taking the `webview` +
 * `extensionUri` the originals read off `this`.
 *
 * Re-exported through the `panel.ts` barrel; consumed by the panel
 * controller.
 */

import * as vscode from 'vscode';
import { renderShell, type ShellHostHooks } from '../../webview/shell';

/**
 * Build the webview HTML for the panel.
 *
 * Loop 01: the panel HTML is produced by the shared shell renderer
 * (`src/webview/shell.ts`) so the static webview and the VS Code panel
 * cannot drift on stylesheets, libs, or mount-point IDs. This host plugs in
 * `webview.asWebviewUri` for asset URL resolution and supplies the CSP +
 * per-render nonce.
 */
export function getHtmlForWebview(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const distWebview = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
    const nonce = getNonce();

    const resolveRel = (rel: string): string =>
        webview.asWebviewUri(vscode.Uri.joinPath(distWebview, ...rel.split('/'))).toString();

    const csp = `default-src 'none'; ` +
        `style-src ${webview.cspSource} 'unsafe-inline'; ` +
        `script-src 'nonce-${nonce}'; ` +
        `font-src ${webview.cspSource}; ` +
        `img-src ${webview.cspSource} https: data:;`;

    const hooks: ShellHostHooks = {
        resolveStyle: resolveRel,
        resolveLib: resolveRel,
        resolveScript: resolveRel,
        csp,
        nonce,
    };

    // VS Code data path uses postMessage, not data scripts.
    return renderShell({ hooks, title: 'LLMem', dataScriptUrls: [] });
}

/** Generate a per-render CSP nonce. */
export function getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}
