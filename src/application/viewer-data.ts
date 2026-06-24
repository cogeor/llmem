/**
 * Viewer-data service: aggregate the JSON shape the LLMem viewer renders.
 *
 * This is the application-layer service that the VS Code panel and the
 * VS Code hot-reload service consume. (The HTTP server's webview is
 * generated through a different path and does not call this; Loop 11 owns
 * the eventual HTTP-side migration.)
 *
 * What moved here in Loop 06: `WebviewDataService.collectData` and its
 * sibling `collectDataWithSplitEdgeLists`, plus the private helpers
 * `populateTreeStatus` and `scanAndPopulateSplitEdgeLists`. The legacy
 * file `src/webview/data-service.ts` is deleted in this same loop.
 *
 * Logger discipline: this module MUST NOT call console.*. The `ctx.logger`
 * is used; hosts construct the context with a NoopLogger by default (see
 * `application/workspace-context.ts`).
 *
 * Markdown rendering: the application layer does NOT render markdown.
 * `designDocs` is returned as `Record<string, string>` of raw markdown,
 * keyed by the design-doc key contract from `docs/arch-store`. Callers
 * (panel, hot-reload) render at the consumption boundary using
 * `webview/design-docs.ts`.
 *
 * Loop 04: signatures are now `(ctx)` / `(ctx, request)` — the parallel
 * `(workspaceRoot, artifactRoot, io, logger)` bag is gone. The `ctx.archRoot`
 * field is used directly (single source of truth for the `.arch` prefix
 * lives on the context).
 */

import * as path from 'path';
import { asWorkspaceRoot, asAbsPath } from '../core/paths';
import { generateWorkTree, type ITreeNode } from './viewer/worktree';
import {
    prepareWebviewDataFromSplitEdgeLists,
    type WebviewGraphData,
} from '../graph/webview-data';
import { ImportEdgeListStore, CallEdgeListStore } from '../graph/edgelist';
import { computeAllFolderStatuses } from './viewer/graph-status';
import { WatchService } from '../graph/worktree-state';
import type { WorkspaceContext } from './workspace-context';
import { buildHealthOverlay } from './analysis/webview-overlay';
import { ensureGitignored } from './ensure-gitignored';
import {
    toWorkspaceRel,
    scanAndPopulateSplitEdgeLists,
    collectRawDesignDocs,
} from './viewer-data/helpers';

/**
 * Once-per-process guard so `ensureGitignored` does not re-read `.gitignore`
 * on every viewer-data call. Keyed by workspace root so a process that serves
 * multiple workspaces still ensures each one exactly once.
 */
const gitignoreEnsured = new Set<string>();

/**
 * Shape of the data the viewer renders. Note: `designDocs` is RAW markdown.
 * Callers that need rendered HTML (the VS Code panel, the hot-reload push)
 * render at the consumption boundary.
 */
export interface ViewerData {
    graphData: WebviewGraphData;
    workTree: ITreeNode;
    designDocs: Record<string, string>;
}

/**
 * Collect all data required for the viewer from disk.
 *
 * If edge lists exist under `ctx.artifactRoot`, they are loaded. Otherwise
 * a TS scan populates them and saves. The `ctx.archRoot` and
 * `ctx.artifactRoot` directories are created (recursive) when missing.
 */
export async function collectViewerData(
    ctx: WorkspaceContext,
): Promise<ViewerData> {
    const { workspaceRoot, artifactRoot, archRoot, io, logger } = ctx;

    // Ensure artifact root exists. The realpath-strong `io.mkdirRecursive`
    // walks up to the nearest existing ancestor and asserts containment.
    const artifactRel = toWorkspaceRel(workspaceRoot, artifactRoot);
    await io.mkdirRecursive(artifactRel);

    // First creation of the `.llmem/` dot-folder is our cue to ensure a single
    // blanket `.llmem/` line in the repo's .gitignore (append-only, idempotent;
    // see ensure-gitignored.ts). Once per workspace per process.
    if (!gitignoreEnsured.has(workspaceRoot)) {
        gitignoreEnsured.add(workspaceRoot);
        try {
            await ensureGitignored(workspaceRoot, io, undefined, logger);
        } catch (e) {
            logger.error(
                `[WebviewDataService] ensureGitignored failed: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
    }

    // Load or generate split edge lists
    const importStore = new ImportEdgeListStore(artifactRoot, io);
    const callStore = new CallEdgeListStore(artifactRoot, io);

    const importPath = path.join(artifactRoot, 'import-edgelist.json');
    const callPath = path.join(artifactRoot, 'call-edgelist.json');
    const importRel = toWorkspaceRel(workspaceRoot, importPath);
    const callRel = toWorkspaceRel(workspaceRoot, callPath);

    if ((await io.exists(importRel)) && (await io.exists(callRel))) {
        // Both edge lists exist - load them
        await importStore.load();
        await callStore.load();
        logger.info('[WebviewDataService] Loaded existing split edge lists');
    } else {
        // Edge lists don't exist - scan codebase and create them
        logger.info('[WebviewDataService] Edge lists not found, scanning codebase...');
        try {
            await scanAndPopulateSplitEdgeLists(workspaceRoot, importStore, callStore, logger);
            await importStore.save();
            await callStore.save();
            logger.info('[WebviewDataService] Split edge lists created and saved');
        } catch (scanError) {
            logger.error(`[WebviewDataService] Failed to scan codebase: ${scanError instanceof Error ? scanError.message : String(scanError)}`);
            logger.info('[WebviewDataService] Continuing with empty edge lists');
        }
    }

    const importStats = importStore.getStats();
    const callStats = callStore.getStats();
    logger.info(`[WebviewDataService] Import graph: ${importStats.nodes} nodes, ${importStats.edges} edges`);
    logger.info(`[WebviewDataService] Call graph: ${callStats.nodes} nodes, ${callStats.edges} edges`);

    // Ensure the docs dir exists. `io.mkdirRecursive` surfaces a structured
    // PathEscapeError if the candidate escapes the workspace, which can't
    // happen for the well-known `ctx.archRootRel` relative path (.llmem/docs).
    try {
        await io.mkdirRecursive(ctx.archRootRel);
    } catch (e) {
        logger.error(`Failed to create docs directory: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Load watched files state
    const watchService = new WatchService(artifactRoot, workspaceRoot, io);
    await watchService.load();
    const watchedFiles = new Set(watchService.getWatchedFiles());
    logger.info(`[WebviewDataService] Loaded ${watchedFiles.size} watched files`);

    // Loop 08: assemble the health overlay (clone edges + node smells) from the
    // persisted clone-edgelist + cheap hub arithmetic. Tolerant — empty when
    // artifacts are absent.
    const health = await buildHealthOverlay(ctx);

    // 1. Graph Data (from split edge lists, filtered by watched files)
    const graphData = prepareWebviewDataFromSplitEdgeLists(
        importStore.getData(),
        callStore.getData(),
        watchedFiles.size > 0 ? watchedFiles : undefined,
        health,
    );
    logger.info(`[WebviewDataService] Graph data prepared: import ${graphData.importGraph.nodes.length} nodes, call ${graphData.callGraph.nodes.length} nodes`);

    // 2. Work Tree with graph status
    const workTree = await generateWorkTree(io);

    // Populate graph status for directories
    const folderStatuses = await computeAllFolderStatuses(workspaceRoot, artifactRoot, io);
    populateTreeStatus(workTree, folderStatuses);

    // 3. Design Docs (raw markdown — caller renders)
    const designDocs = await collectRawDesignDocs(workspaceRoot, archRoot, io, logger);

    return {
        graphData,
        workTree,
        designDocs,
    };
}

/**
 * Recursively populate graph status fields in the worktree.
 * Files inherit status from their parent folder.
 *
 * Lifted verbatim from `WebviewDataService.populateTreeStatus`.
 */
function populateTreeStatus(
    node: ITreeNode,
    statuses: Map<string, { importStatus: 'never' | 'outdated' | 'current'; callStatus: 'never' | 'outdated' | 'current' }>,
    parentStatus?: { importStatus: 'never' | 'outdated' | 'current'; callStatus: 'never' | 'outdated' | 'current' },
): void {
    if (node.type === 'directory') {
        const status = statuses.get(node.path || '.');
        if (status) {
            node.importStatus = status.importStatus;
            node.callStatus = status.callStatus;
        } else if (parentStatus) {
            // Inherit from parent if no status computed for this folder
            node.importStatus = parentStatus.importStatus;
            node.callStatus = parentStatus.callStatus;
        }

        const currentStatus = status || parentStatus;
        if (node.children) {
            for (const child of node.children) {
                populateTreeStatus(child, statuses, currentStatus);
            }
        }
    } else {
        // Files inherit status from parent folder
        if (parentStatus) {
            node.importStatus = parentStatus.importStatus;
            node.callStatus = parentStatus.callStatus;
        }
    }
}

// Re-export helpers used at module boundaries (callers that need to brand
// plain strings before passing them in).
export { asWorkspaceRoot, asAbsPath };
