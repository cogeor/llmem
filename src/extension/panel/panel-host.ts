/**
 * Panel host contract (Loop 15 split).
 *
 * The narrow surface the extracted data-handlers + message-router need from
 * the `LLMemPanel` controller. Passing this interface (rather than the whole
 * panel) keeps the handlers free functions while preserving the exact
 * `this`-bound reads/writes the former methods performed:
 *   - `webview`          — the post target (`this._panel.webview`).
 *   - `getCtx`/`setCtx`  — the per-panel `WorkspaceContext` (`this._ctx`).
 *   - `getHotReload`/`setHotReload` — the hot-reload service (`this._hotReload`).
 *   - `addDisposable`    — push onto `this._disposables`.
 *   - `panelLogger`      — the boundary logger bridge (`this._panelLogger()`).
 */

import type * as vscode from 'vscode';
import type { WorkspaceContext } from '../../application/workspace-context';
import type { Logger as BoundaryLogger } from '../../core/logger';
import type { HotReloadService } from '../hot-reload';

export interface PanelHost {
    readonly webview: vscode.Webview;
    getCtx(): WorkspaceContext | null;
    setCtx(ctx: WorkspaceContext): void;
    getHotReload(): HotReloadService | undefined;
    setHotReload(svc: HotReloadService): void;
    addDisposable(d: vscode.Disposable): void;
    panelLogger(): BoundaryLogger;
}
