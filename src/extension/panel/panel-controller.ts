/**
 * Panel controller (Loop 15 split).
 *
 * Carved from the former `panel.ts` monolith: the `LLMemPanel` class shell
 * — lifecycle (`createOrShow` / constructor / `dispose`), the panel state
 * (`_panel`, `_extensionUri`, `_ctx`, `_hotReload`, `_disposables`), and the
 * `PanelHost` implementation the extracted handlers consume. The message
 * routing, data handlers, HTML rendering, and markdown rendering live in the
 * sibling modules.
 *
 * Re-exported through the `panel.ts` barrel; `extension.ts` imports
 * `LLMemPanel` unchanged.
 */

import * as vscode from 'vscode';
import type { WorkspaceContext } from '../../application/workspace-context';
import type { Logger as BoundaryLogger } from '../../core/logger';
import { createLogger } from '../../common/logger';
import type { HotReloadService } from '../hot-reload';
import type { PanelHost } from './panel-host';
import { handleMessage } from './panel-message-router';
import { getHtmlForWebview } from './panel-html';

const log = createLogger('panel');

/**
 * Manages the LLMem Webview Panel
 *
 * Serves the bundled webview UI from dist/webview/ and integrates with
 * HotReloadService to push data updates when files change.
 *
 * Loop 04: replaces five per-handler `WorkspaceIO.create` calls with a
 * single `_ctx: WorkspaceContext` built once on `webview:ready` and
 * shared across every handler.
 */
export class LLMemPanel implements PanelHost {
    public static currentPanel: LLMemPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _hotReload: HotReloadService | undefined;

    /**
     * Loop 04: per-workspace runtime context, built once on
     * `webview:ready` and reused by every handler. Null until the
     * `webview:ready` message arrives — handlers guard for that to
     * surface a graceful error instead of throwing on a missing field.
     */
    private _ctx: WorkspaceContext | null = null;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._panel.webview.html = getHtmlForWebview(this._panel.webview, this._extensionUri);

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            msg => handleMessage(this, msg),
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

    // ---- PanelHost implementation ----------------------------------------

    public get webview(): vscode.Webview {
        return this._panel.webview;
    }

    public getCtx(): WorkspaceContext | null {
        return this._ctx;
    }

    public setCtx(ctx: WorkspaceContext): void {
        this._ctx = ctx;
    }

    public getHotReload(): HotReloadService | undefined {
        return this._hotReload;
    }

    public setHotReload(svc: HotReloadService): void {
        this._hotReload = svc;
    }

    public addDisposable(d: vscode.Disposable): void {
        this._disposables.push(d);
    }

    /**
     * Build a Logger that bridges scan / viewer-data progress through the
     * structured logger.
     *
     * Loop 20: targets are now leveled `log.<info|warn|error>` calls with
     * scope='panel' instead of raw `console.*`. The boundary `Logger`
     * interface stays the same, so application-layer callers see no
     * change. Replacing this with a VS Code OutputChannel sink is a
     * future-loop concern (Loop 52 panel split).
     */
    public panelLogger(): BoundaryLogger {
        return {
            info: (m) => log.info(m),
            warn: (m) => log.warn(m),
            error: (m) => log.error(m),
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
