/**
 * Toggle-watch workflow. Application-layer entry point for "add this path
 * to the watched set" / "remove this path from the watched set" — the
 * single workflow used by both the VS Code panel
 * (`extension/panel.ts::_handleToggleWatch`) and the HTTP server
 * (`claude/server/index.ts` `/api/watch`).
 *
 * Loop 09 lifts the duplicated workflow:
 *   - Panel had inline `WatchService` instantiation, edge regeneration via
 *     `scanFile`/`scanFolderRecursive`, and inline `removeByFolder` calls
 *     against both edge stores.
 *   - Server had the same plus a thin `WatchManager` wrapper.
 *
 * After this module both hosts shrink to: parse host-specific input →
 * call `addWatchedPath` / `removeWatchedPath` → push the result back
 * through the host-specific output (webview message vs HTTP JSON).
 *
 * Workflow split into two functions rather than one with a `kind` flag:
 * add scans (parser + edge-list mutation + save), remove deletes
 * (edge-list `removeByFolder`). The asymmetry doesn't pay for a
 * discriminated union.
 *
 * Out of scope:
 *   - Hot-reload integration (`HotReloadService.addWatchedPath`) stays in
 *     the panel. The application function returns `addedFiles` /
 *     `removedFiles` so the panel iterates and dispatches HMR.
 *   - WatchService relocation. It still lives in `graph/worktree-state.ts`.
 *     Loop 16 (graph schema) decides whether to move it.
 */

import type { WorkspaceRoot, AbsPath, RelPath } from '../core/paths';
import { asRelPath } from '../core/paths';
import type { Logger } from '../core/logger';
import { NoopLogger } from '../core/logger';
import { WorkspaceIO } from '../workspace/workspace-io';
import { WatchService } from '../graph/worktree-state';
import { CallEdgeListStore, ImportEdgeListStore } from '../graph/edgelist';
import { scanFile, scanFolderRecursive } from './scan';

// ============================================================================
// Public types
// ============================================================================

export interface AddWatchedPathRequest {
    workspaceRoot: WorkspaceRoot;
    /** Absolute path to the artifact directory (.artifacts). */
    artifactRoot: AbsPath;
    /** Workspace-relative target path (file or folder, forward slashes). */
    targetPath: RelPath;
    /** Optional logger. Defaults to a no-op. */
    logger?: Logger;
}

export interface AddWatchedPathResult {
    success: boolean;
    /** Optional human-readable status, mirrors the HTTP JSON shape. */
    message?: string;
    /** Resolved file list — folder targets expanded to their contained files. */
    addedFiles: RelPath[];
    /** Full set of watched files after the add. */
    watchedFiles: RelPath[];
}

export interface RemoveWatchedPathRequest {
    workspaceRoot: WorkspaceRoot;
    artifactRoot: AbsPath;
    targetPath: RelPath;
    logger?: Logger;
}

export interface RemoveWatchedPathResult {
    success: boolean;
    message?: string;
    /** Files that were removed (folder targets expanded). */
    removedFiles: RelPath[];
    /** Full set of watched files after the remove. */
    watchedFiles: RelPath[];
}

// ============================================================================
// addWatchedPath
// ============================================================================

/**
 * Add a file or folder to the watched set, scan it for edges, and
 * persist both the watch-state and the updated edge lists.
 *
 * File vs folder detection lives here (not in the host) so the workflow
 * stays uniform — hosts pass a workspace-relative path and never decide
 * which scan helper to invoke.
 */
export async function addWatchedPath(
    req: AddWatchedPathRequest,
): Promise<AddWatchedPathResult> {
    const { workspaceRoot, artifactRoot, targetPath } = req;
    const logger = req.logger ?? NoopLogger;

    // L24: realpath-strong I/O surface anchored on the workspace root.
    // io.exists / io.stat throw PathEscapeError on attempts to escape, so
    // the previous resolveInsideWorkspace + fs.existsSync pair collapses
    // to a single io.exists call.
    const io = await WorkspaceIO.create(workspaceRoot);

    if (!(await io.exists(targetPath))) {
        return {
            success: false,
            message: `Path does not exist: ${targetPath}`,
            addedFiles: [],
            watchedFiles: [],
        };
    }

    const isDirectory = (await io.stat(targetPath)).isDirectory();

    const watchService = new WatchService(artifactRoot, workspaceRoot, io);
    await watchService.load();

    // Add to watch state. addFolder returns only files newly added (it
    // dedupes against the existing set); addFile is unconditional but
    // a single file repeated is also dedup'd by the underlying Set.
    let addedFiles: string[];
    if (isDirectory) {
        addedFiles = await watchService.addFolder(targetPath);
    } else {
        await watchService.addFile(targetPath);
        addedFiles = [targetPath];
    }

    // Run the scan workflow to populate edge lists. Scan helpers manage
    // their own load/save against ImportEdgeListStore + CallEdgeListStore.
    try {
        if (isDirectory) {
            await scanFolderRecursive({
                workspaceRoot,
                folderPath: targetPath,
                artifactDir: artifactRoot,
                io,
                logger,
            });
        } else {
            await scanFile({
                workspaceRoot,
                filePath: targetPath,
                artifactDir: artifactRoot,
                io,
                logger,
            });
        }
    } catch (e: any) {
        // Persist the watch-state update even if scan fails so the user
        // can see the path is being watched. Surface the scan error in
        // the result message.
        await watchService.save();
        return {
            success: false,
            message: `Watched ${targetPath} but scan failed: ${e?.message ?? String(e)}`,
            addedFiles: addedFiles.map(asRelPath),
            watchedFiles: watchService.getWatchedFiles().map(asRelPath),
        };
    }

    await watchService.save();

    return {
        success: true,
        message: `Added ${addedFiles.length} file(s) to watch`,
        addedFiles: addedFiles.map(asRelPath),
        watchedFiles: watchService.getWatchedFiles().map(asRelPath),
    };
}

// ============================================================================
// removeWatchedPath
// ============================================================================

/**
 * Remove a file or folder from the watched set, delete its edges from
 * both edge-list stores, and persist the updated watch-state.
 *
 * The previous panel and server both inlined a "load both edge stores,
 * call removeByFolder, save" block. That block now lives here exactly
 * once.
 */
export async function removeWatchedPath(
    req: RemoveWatchedPathRequest,
): Promise<RemoveWatchedPathResult> {
    const { workspaceRoot, artifactRoot, targetPath } = req;
    const logger = req.logger ?? NoopLogger;

    // L24: path containment via WorkspaceIO. Unlike the add path we
    // tolerate a missing on-disk target (the user may be removing a stale
    // watch entry); we still refuse path-escape attempts (io.exists /
    // io.stat throw PathEscapeError up to the host).
    const io = await WorkspaceIO.create(workspaceRoot);

    const isDirectory =
        (await io.exists(targetPath)) && (await io.stat(targetPath)).isDirectory();

    const watchService = new WatchService(artifactRoot, workspaceRoot, io);
    await watchService.load();

    // Remove from watch state.
    let removedFiles: string[];
    if (isDirectory) {
        removedFiles = watchService.removeFolder(targetPath);
    } else {
        // For a missing or file target the WatchService treats removeFile
        // and removeFolder identically when no descendants exist. Call
        // removeFolder to also catch stale folder entries — it's a
        // strict superset on file paths.
        const folderRemoved = watchService.removeFolder(targetPath);
        if (folderRemoved.length > 0) {
            removedFiles = folderRemoved;
        } else {
            watchService.removeFile(targetPath);
            removedFiles = [targetPath];
        }
    }

    // Delete edges for the path from both stores. L24: `io` threaded for
    // realpath-strong save; the boundary `Logger` interface here differs
    // from the edge-list store's `common/logger` shape, so we omit it.
    const importStore = new ImportEdgeListStore(artifactRoot, undefined, io);
    await importStore.load();
    importStore.removeByFolder(targetPath);
    await importStore.save();

    const callStore = new CallEdgeListStore(artifactRoot, undefined, io);
    await callStore.load();
    callStore.removeByFolder(targetPath);
    await callStore.save();

    await watchService.save();

    logger.info(`[ToggleWatch] Removed ${removedFiles.length} file(s) under ${targetPath}`);

    return {
        success: true,
        message: `Removed ${removedFiles.length} file(s) from watch`,
        removedFiles: removedFiles.map(asRelPath),
        watchedFiles: watchService.getWatchedFiles().map(asRelPath),
    };
}
