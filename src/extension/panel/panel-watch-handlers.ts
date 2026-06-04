/**
 * Panel watch + init handlers (Loop 15 split).
 *
 * Carved verbatim from the former `panel.ts` monolith: the toggle-watch
 * workflow and the `webview:ready` hot-reload bootstrap that builds the
 * per-panel `WorkspaceContext`, scans changed files, starts the
 * `HotReloadService`, and sends the initial data payload. The former
 * `private` methods read/wrote `this._ctx`, `this._hotReload`,
 * `this._disposables` and posted to `this._panel.webview`; here they are
 * free functions taking a narrow `PanelHost` so the controller stays thin.
 *
 * Dynamic import (`import('../../graph/worktree-state')`) is preserved
 * exactly.
 *
 * Re-exported through the `panel.ts` barrel; consumed by the message router.
 */

import * as vscode from 'vscode';
import { getConfig } from '../../runtime/config';
import { collectViewerData } from '../../application/viewer-data';
import { scanFile } from '../../application/scan';
import { addWatchedPath, removeWatchedPath } from '../../application/toggle-watch';
import { initWorkspaceContext } from '../../application/workspace-context';
import { createLogger } from '../../common/logger';
import { asRelPath } from '../../core/paths';
import { HotReloadService } from '../hot-reload';
import type { PanelHost } from './panel-host';
import { toRenderedViewerData } from './panel-markdown-renderer';

const log = createLogger('panel');

/**
 * Handle toggle-watch message. Loop 09 lifted the workflow into
 * `application/toggle-watch.ts`; this handler is a thin wrapper that
 * dispatches the result back to the webview and into hot-reload.
 *
 * Loop 14: the webview includes a `requestId` so concurrent toggles
 * map to their own pending promise. We echo it back unchanged in the
 * `state:watchedPaths` response. Older (pre-14) webviews omit the id;
 * we forward `undefined` and the browser side falls back to oldest-
 * pending resolution.
 *
 * Loop 04: shares the panel's `_ctx` for both the toggle workflow
 * and the subsequent `collectViewerData` refresh.
 */
export async function handleToggleWatch(
    host: PanelHost,
    targetPath: string,
    watched: boolean,
    requestId?: string,
): Promise<void> {
    const ctx = host.getCtx();
    if (!ctx) {
        vscode.window.showErrorMessage('Toggle watch failed: panel context not initialized');
        return;
    }
    const hotReload = host.getHotReload();
    log.info('Toggle watch', { targetPath, watched });
    try {
        if (watched) {
            const result = await addWatchedPath(ctx, { targetPath: asRelPath(targetPath) });
            for (const f of result.addedFiles) hotReload?.addWatchedPath(f);
            host.webview.postMessage({
                type: 'state:watchedPaths',
                requestId,
                paths: result.watchedFiles,
                addedFiles: result.addedFiles,
            });
            if (!result.success && result.message) vscode.window.showWarningMessage(result.message);
        } else {
            const result = await removeWatchedPath(ctx, { targetPath: asRelPath(targetPath) });
            for (const f of result.removedFiles) hotReload?.removeWatchedPath(f);
            host.webview.postMessage({
                type: 'state:watchedPaths',
                requestId,
                paths: result.watchedFiles,
                removedFiles: result.removedFiles,
            });
        }
        const raw = await collectViewerData(ctx);
        const rendered = await toRenderedViewerData(raw);
        host.webview.postMessage({ type: 'data:refresh', data: rendered });
    } catch (e: any) {
        vscode.window.showErrorMessage(`Toggle watch failed: ${e?.message ?? String(e)}`);
    }
}

export async function startHotReloadAndSendInitialData(host: PanelHost): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        log.error('No workspace root');
        return;
    }

    // Loop 04: build the per-workspace context once. Every other
    // handler reads `this._ctx` instead of reconstructing
    // `WorkspaceIO.create`. `getConfig().artifactRoot` is the user
    // setting today; threading it through `configOverrides` keeps the
    // existing override behavior intact.
    const ctx = await initWorkspaceContext({
        workspaceRoot: workspaceRoot,
        configOverrides: { artifactRoot: getConfig().artifactRoot },
        logger: host.panelLogger(),
    });
    host.setCtx(ctx);

    log.debug('Using WatchService with file-only tracking');

    // Load watch state using WatchService
    const { WatchService } = await import('../../graph/worktree-state');
    const watchService = new WatchService(ctx.artifactRoot, ctx.workspaceRoot, ctx.io);
    await watchService.load();

    const watchedFiles = watchService.getWatchedFiles();
    log.debug('Found watched files', { count: watchedFiles.length });

    // Detect changed files and regenerate edges
    if (watchedFiles.length > 0) {
        const changedFiles = await watchService.getChangedFiles();
        log.debug('Files have changed', { count: changedFiles.length });

        // Regenerate edges for changed files
        for (const filePath of changedFiles) {
            try {
                await scanFile(ctx, { filePath });
            } catch (e) {
                log.error('Failed to regenerate edges', {
                    filePath,
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }

        // Save updated hashes
        if (changedFiles.length > 0) {
            await watchService.save();
        }
    }

    // Start hot reload service. Loop 04: share the panel's context so
    // hot-reload reuses the same `WorkspaceIO` instance.
    const hotReload = new HotReloadService(
        ctx,
        (data) => {
            host.webview.postMessage({
                type: 'data:refresh',
                data: data
            });
        }
    );
    host.setHotReload(hotReload);

    hotReload.start();
    host.addDisposable({ dispose: () => hotReload.stop() });

    // Add watched files to hot reload
    for (const f of watchedFiles) {
        hotReload.addWatchedPath(f);
    }

    // Send initial data
    try {
        log.info('Collecting initial data...');
        const raw = await collectViewerData(ctx);
        const rendered = await toRenderedViewerData(raw);
        host.webview.postMessage({
            type: 'data:init',
            data: rendered
        });
        log.info('Initial data sent', {
            importNodes: rendered.graphData.importGraph.nodes.length,
            importEdges: rendered.graphData.importGraph.edges.length,
            callNodes: rendered.graphData.callGraph.nodes.length,
            callEdges: rendered.graphData.callGraph.edges.length,
        });

        // Send watched files to webview
        if (watchedFiles.length > 0) {
            host.webview.postMessage({
                type: 'state:watchedPaths',
                paths: watchedFiles
            });
            log.debug('Sent watched files to webview', { count: watchedFiles.length });
        }
    } catch (e) {
        log.error('Initial data load failed', {
            error: e instanceof Error ? e.message : String(e),
        });
        host.webview.postMessage({
            type: 'data:init',
            data: {
                graphData: { importGraph: { nodes: [], edges: [] }, callGraph: { nodes: [], edges: [] } },
                workTree: { name: 'root', path: '', type: 'directory', children: [] },
                designDocs: {}
            }
        });
    }
}
