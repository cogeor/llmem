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
 * Logger discipline: this module MUST NOT call console.*. Pass a
 * Logger; NoopLogger is used when none is provided. (Same shape used by
 * `application/scan.ts`.)
 *
 * Markdown rendering: the application layer does NOT render markdown.
 * `designDocs` is returned as `Record<string, string>` of raw markdown,
 * keyed by the design-doc key contract from `docs/arch-store`. Callers
 * (panel, hot-reload) render at the consumption boundary using
 * `webview/design-docs.ts`. This is the deliberate Loop 06 design
 * correction: presentation lives in the presentation layer.
 *
 * `.arch` walker: inlined here rather than reaching into
 * `DesignDocManager` (a webview-layer module). The inline walker is ~20
 * lines and avoids creating a new `application -> webview` boundary
 * violation. `getArchRoot` and `getDesignDocKey` from `docs/arch-store`
 * provide the path mapping.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { WorkspaceRoot, AbsPath } from '../core/paths';
import { asWorkspaceRoot, asAbsPath, asRelPath } from '../core/paths';
import type { Logger } from '../core/logger';
import { NoopLogger } from '../core/logger';
import { safeMkdir, safeReadFile } from '../workspace/safe-fs';
import { getArchRoot, getDesignDocKey } from '../docs/arch-store';
import { generateWorkTree, type ITreeNode } from '../webview/worktree';
import {
    prepareWebviewDataFromSplitEdgeLists,
    type WebviewGraphData,
} from '../graph/webview-data';
import { ImportEdgeListStore, CallEdgeListStore } from '../graph/edgelist';
import { TypeScriptService } from '../parser/ts-service';
import { TypeScriptExtractor } from '../parser/ts-extractor';
import { artifactToEdgeList } from '../graph/artifact-converter';
import { LAZY_CODEBASE_LINE_THRESHOLD } from '../parser/config';
import { computeAllFolderStatuses } from '../webview/graph-status';
import { WatchService } from '../graph/worktree-state';

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

export interface CollectViewerDataOptions {
    workspaceRoot: WorkspaceRoot;
    artifactRoot: AbsPath;
    logger?: Logger;
}

/**
 * Options for the lower-level helper used by hot-reload, which already
 * holds open `EdgeListStore` instances and doesn't want to pay the
 * load/save round-trip again.
 */
export interface CollectViewerDataWithStoresOptions {
    workspaceRoot: WorkspaceRoot;
    importStore: ImportEdgeListStore;
    callStore: CallEdgeListStore;
    /** When provided, watched-files filtering is applied. */
    artifactRoot?: AbsPath;
    logger?: Logger;
}

/**
 * Collect all data required for the viewer from disk.
 *
 * If edge lists exist under `artifactRoot`, they are loaded. Otherwise
 * a TS scan populates them and saves. `.arch` and `.artifacts`
 * directories are created (recursive) when missing.
 */
export async function collectViewerData(
    opts: CollectViewerDataOptions,
): Promise<ViewerData> {
    const { workspaceRoot, artifactRoot } = opts;
    const logger = opts.logger ?? NoopLogger;

    // Ensure artifact root exists (safeMkdir does { recursive: true }
    // internally; resolveInsideWorkspace accepts absolute paths that fall
    // under root). We pass the relative form to satisfy the RelPath brand.
    const artifactRel = path.relative(workspaceRoot, artifactRoot).replace(/\\/g, '/');
    await safeMkdir(workspaceRoot, asRelPath(artifactRel));

    // Load or generate split edge lists
    const importStore = new ImportEdgeListStore(artifactRoot);
    const callStore = new CallEdgeListStore(artifactRoot);

    const importPath = path.join(artifactRoot, 'import-edgelist.json');
    const callPath = path.join(artifactRoot, 'call-edgelist.json');

    if (fs.existsSync(importPath) && fs.existsSync(callPath)) {
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

    // Ensure .arch exists. The legacy code swallowed mkdir errors via a
    // try/catch around an inline mkdirSync; safeMkdir surfaces a structured
    // PathEscapeError if the candidate escapes the workspace, which can't
    // happen for the well-known '.arch' relative path.
    const archRoot = getArchRoot(workspaceRoot);
    try {
        await safeMkdir(workspaceRoot, asRelPath('.arch'));
    } catch (e) {
        logger.error(`Failed to create .arch directory: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Load watched files state
    const watchService = new WatchService(artifactRoot, workspaceRoot);
    await watchService.load();
    const watchedFiles = new Set(watchService.getWatchedFiles());
    logger.info(`[WebviewDataService] Loaded ${watchedFiles.size} watched files`);

    // 1. Graph Data (from split edge lists, filtered by watched files)
    const graphData = prepareWebviewDataFromSplitEdgeLists(
        importStore.getData(),
        callStore.getData(),
        watchedFiles.size > 0 ? watchedFiles : undefined,
    );
    logger.info(`[WebviewDataService] Graph data prepared: import ${graphData.importGraph.nodes.length} nodes, call ${graphData.callGraph.nodes.length} nodes`);

    // 2. Work Tree with graph status
    const workTree = await generateWorkTree(workspaceRoot, workspaceRoot);

    // Populate graph status for directories
    const folderStatuses = await computeAllFolderStatuses(workspaceRoot, artifactRoot);
    populateTreeStatus(workTree, folderStatuses);

    // 3. Design Docs (raw markdown — caller renders)
    const designDocs = await collectRawDesignDocs(workspaceRoot, archRoot, logger);

    return {
        graphData,
        workTree,
        designDocs,
    };
}

/**
 * Variant for callers that already hold open EdgeListStore instances
 * (e.g. hot-reload). Skips the file-existence check and store load.
 *
 * NOTE: this helper is currently UNUSED in the codebase (verified via
 * grep before Loop 06). Lifted along with `collectViewerData` because
 * the legacy `WebviewDataService.collectDataWithSplitEdgeLists` did the
 * same work; if it is still unused after Loop 12, delete it.
 */
export async function collectViewerDataWithStores(
    opts: CollectViewerDataWithStoresOptions,
): Promise<ViewerData> {
    const { workspaceRoot, importStore, callStore, artifactRoot } = opts;
    const logger = opts.logger ?? NoopLogger;

    // Ensure .arch exists (see collectViewerData for safeMkdir notes).
    const archRoot = getArchRoot(workspaceRoot);
    try {
        await safeMkdir(workspaceRoot, asRelPath('.arch'));
    } catch (e) {
        logger.error(`Failed to create .arch directory: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Load watched files state (if artifactRoot provided)
    let watchedFiles: Set<string> | undefined;
    if (artifactRoot) {
        const watchService = new WatchService(artifactRoot, workspaceRoot);
        await watchService.load();
        const watchedFilesArray = watchService.getWatchedFiles();
        watchedFiles = watchedFilesArray.length > 0 ? new Set(watchedFilesArray) : undefined;
        logger.info(`[WebviewDataService] Loaded ${watchedFilesArray.length} watched files`);
    }

    // 1. Graph Data
    const graphData = prepareWebviewDataFromSplitEdgeLists(
        importStore.getData(),
        callStore.getData(),
        watchedFiles,
    );

    // 2. Work Tree
    const workTree = await generateWorkTree(workspaceRoot, workspaceRoot);

    // 3. Design Docs (raw markdown — caller renders)
    const designDocs = await collectRawDesignDocs(workspaceRoot, archRoot, logger);

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

/**
 * Scan codebase and populate split edge lists with TypeScript files.
 * Uses lazy loading: skips call edges for folders exceeding line threshold.
 *
 * Lifted verbatim from `WebviewDataService.scanAndPopulateSplitEdgeLists`,
 * with `console.*` calls replaced by `logger.*`.
 */
async function scanAndPopulateSplitEdgeLists(
    workspaceRoot: WorkspaceRoot,
    importStore: ImportEdgeListStore,
    callStore: CallEdgeListStore,
    logger: Logger,
): Promise<void> {
    // Initialize TypeScript service
    const tsService = new TypeScriptService(workspaceRoot);
    const tsExtractor = new TypeScriptExtractor(() => tsService.getProgram(), workspaceRoot);

    const program = tsService.getProgram();
    if (!program) {
        logger.warn('[WebviewDataService] No TypeScript program created - this is expected for non-TS/JS projects');
        logger.warn('[WebviewDataService] TypeScript files will not be processed. Other languages use tree-sitter parsers.');
        return;
    }

    // Get all source files (excluding node_modules, declaration files)
    const normalizedRoot = (workspaceRoot as string).replace(/\\/g, '/');
    const sourceFiles = program.getSourceFiles().filter((sf) => {
        const filePath = sf.fileName.replace(/\\/g, '/');
        return !filePath.includes('node_modules') &&
            !filePath.endsWith('.d.ts') &&
            filePath.startsWith(normalizedRoot);
    });

    logger.info(`[WebviewDataService] Scanning ${sourceFiles.length} TypeScript files...`);

    // Count total lines in the codebase to determine eager vs lazy mode
    let totalCodebaseLines = 0;
    for (const sf of sourceFiles) {
        totalCodebaseLines += sf.getEnd(); // Approximate line count from source file length
    }

    const isLazyMode = totalCodebaseLines > LAZY_CODEBASE_LINE_THRESHOLD;
    logger.info(`[WebviewDataService] Total codebase lines: ~${totalCodebaseLines}, lazy mode: ${isLazyMode} (threshold: ${LAZY_CODEBASE_LINE_THRESHOLD})`);

    let processedCount = 0;

    for (const sf of sourceFiles) {
        const filePath = sf.fileName;
        const relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');

        try {
            // In lazy mode, only create file node (edges loaded on demand)
            if (isLazyMode) {
                const fileNode = {
                    id: relativePath,
                    name: path.basename(filePath),
                    kind: 'file' as const,
                    fileId: relativePath,
                };
                importStore.addNode(fileNode);
                callStore.addNode(fileNode);
                processedCount++;
                continue;
            }

            // Normal processing for small folders
            const artifact = await tsExtractor.extract(filePath);
            if (!artifact) continue;

            const { nodes, importEdges, callEdges } = artifactToEdgeList(artifact, relativePath);

            // Add nodes to both stores
            importStore.addNodes(nodes);
            callStore.addNodes(nodes);

            // Add all edges
            importStore.addEdges(importEdges);
            callStore.addEdges(callEdges);

            processedCount++;
        } catch {
            // Silently skip problematic files (matches legacy behavior)
        }
    }

    logger.info(`[WebviewDataService] Processed ${processedCount} files`);
}

/**
 * Walk `.arch` and return raw markdown keyed by the design-doc key.
 *
 * Replaces `new DesignDocManager(projectRoot).getAllDocsAsync()`. Skips
 * the `marked` render step — callers render on consumption.
 *
 * Returns an empty map if `.arch` does not exist.
 */
async function collectRawDesignDocs(
    workspaceRoot: WorkspaceRoot,
    archRoot: AbsPath,
    logger: Logger,
): Promise<Record<string, string>> {
    const docs: Record<string, string> = {};

    if (!fs.existsSync(archRoot)) {
        return docs;
    }

    // Collect all files under archRoot (sync walk; consistent with the
    // legacy DesignDocManager.walk implementation).
    const files: string[] = [];
    try {
        walkDir(archRoot, (f) => files.push(f));
    } catch (e) {
        logger.error(`[WebviewDataService] Error walking .arch: ${e instanceof Error ? e.message : String(e)}`);
    }

    for (const filePath of files) {
        if (!filePath.endsWith('.md')) continue;
        try {
            // Read via safeReadFile. filePath is absolute and inside
            // workspaceRoot/.arch — convert to a workspace-relative path
            // to satisfy the RelPath brand on safe-fs's API.
            const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
            const markdown = await safeReadFile(workspaceRoot, asRelPath(relPath));
            if (markdown === null) continue;
            const key = getDesignDocKey(asAbsPath(archRoot), asAbsPath(filePath));
            docs[key] = markdown;
        } catch (e) {
            logger.error(`Failed to read design doc: ${filePath} — ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    return docs;
}

/** Recursive directory walk; calls `cb(fullPath)` on every file. */
function walkDir(dir: string, cb: (fullPath: string) => void): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkDir(fullPath, cb);
        } else {
            cb(fullPath);
        }
    }
}

// Re-export helpers used at module boundaries (callers that need to brand
// plain strings before passing them in).
export { asWorkspaceRoot, asAbsPath };
