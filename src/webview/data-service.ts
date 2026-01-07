import * as fs from 'fs';
import * as path from 'path';
import { generateWorkTree, ITreeNode } from './worktree';
import { prepareWebviewDataFromSplitEdgeLists, WebviewGraphData } from '../graph/webview-data';
import { DesignDocManager, DesignDoc } from './design-docs';
import { ImportEdgeListStore, CallEdgeListStore } from '../graph/edgelist';
import { TypeScriptService } from '../parser/ts-service';
import { TypeScriptExtractor } from '../parser/ts-extractor';
import { artifactToEdgeList } from '../graph/artifact-converter';
import { countFolderLines } from '../parser/line-counter';
import { LAZY_CODEBASE_LINE_THRESHOLD, IGNORED_FOLDERS } from '../parser/config';
import { computeAllFolderStatuses } from './graph-status';
import { WatchService } from '../graph/worktree-state';

export interface WebviewData {
    graphData: WebviewGraphData;
    workTree: ITreeNode;
    designDocs: { [key: string]: DesignDoc };
}

/**
 * Service to aggregate all data needed for the webview.
 * Shared by both the static generator and the vscode extension.
 */
export class WebviewDataService {

    /**
     * Collects all data required for the webview using split edge lists.
     * If edge lists don't exist, scans the codebase and creates them.
     * 
     * @param projectRoot Root directory of the project to analyze
     * @param artifactRoot Root directory for edge lists (e.g. .artifacts)
     */
    static async collectData(projectRoot: string, artifactRoot: string): Promise<WebviewData> {

        // Ensure artifact root exists
        if (!fs.existsSync(artifactRoot)) {
            fs.mkdirSync(artifactRoot, { recursive: true });
        }

        // Load or generate split edge lists
        const importStore = new ImportEdgeListStore(artifactRoot);
        const callStore = new CallEdgeListStore(artifactRoot);

        const importPath = path.join(artifactRoot, 'import-edgelist.json');
        const callPath = path.join(artifactRoot, 'call-edgelist.json');

        if (fs.existsSync(importPath) && fs.existsSync(callPath)) {
            // Both edge lists exist - load them
            await importStore.load();
            await callStore.load();
            console.log('[WebviewDataService] Loaded existing split edge lists');
        } else {
            // Edge lists don't exist - scan codebase and create them
            console.log('[WebviewDataService] Edge lists not found, scanning codebase...');
            try {
                await this.scanAndPopulateSplitEdgeLists(projectRoot, importStore, callStore);
                await importStore.save();
                await callStore.save();
                console.log('[WebviewDataService] Split edge lists created and saved');
            } catch (scanError) {
                console.error('[WebviewDataService] Failed to scan codebase:', scanError);
                console.log('[WebviewDataService] Continuing with empty edge lists');
            }
        }

        const importStats = importStore.getStats();
        const callStats = callStore.getStats();
        console.log(`[WebviewDataService] Import graph: ${importStats.nodes} nodes, ${importStats.edges} edges`);
        console.log(`[WebviewDataService] Call graph: ${callStats.nodes} nodes, ${callStats.edges} edges`);

        // Ensure .arch exists
        const archRoot = path.join(projectRoot, '.arch');
        if (!fs.existsSync(archRoot)) {
            try {
                fs.mkdirSync(archRoot, { recursive: true });
            } catch (e) {
                console.error('Failed to create .arch directory:', e);
            }
        }

        // Load watched files state
        const watchService = new WatchService(artifactRoot, projectRoot);
        await watchService.load();
        const watchedFiles = new Set(watchService.getWatchedFiles());
        console.log(`[WebviewDataService] Loaded ${watchedFiles.size} watched files`);

        // 1. Graph Data (from split edge lists, filtered by watched files)
        const graphData = prepareWebviewDataFromSplitEdgeLists(
            importStore.getData(),
            callStore.getData(),
            watchedFiles.size > 0 ? watchedFiles : undefined  // Only filter if there are watched files
        );
        console.log(`[WebviewDataService] Graph data prepared: import ${graphData.importGraph.nodes.length} nodes, call ${graphData.callGraph.nodes.length} nodes`);

        // 2. Work Tree with graph status
        const workTree = await generateWorkTree(projectRoot, projectRoot);

        // Populate graph status for directories
        const folderStatuses = await computeAllFolderStatuses(projectRoot, artifactRoot);
        this.populateTreeStatus(workTree, folderStatuses);

        // 3. Design Docs
        const docManager = new DesignDocManager(projectRoot);
        const designDocs = await docManager.getAllDocsAsync();

        return {
            graphData,
            workTree,
            designDocs
        };
    }

    /**
     * Recursively populate graph status fields in the worktree.
     * Files inherit status from their parent folder.
     */
    private static populateTreeStatus(
        node: ITreeNode,
        statuses: Map<string, { importStatus: 'never' | 'outdated' | 'current'; callStatus: 'never' | 'outdated' | 'current' }>,
        parentStatus?: { importStatus: 'never' | 'outdated' | 'current'; callStatus: 'never' | 'outdated' | 'current' }
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
                    this.populateTreeStatus(child, statuses, currentStatus);
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
     */
    private static async scanAndPopulateSplitEdgeLists(
        projectRoot: string,
        importStore: ImportEdgeListStore,
        callStore: CallEdgeListStore
    ): Promise<void> {
        // Initialize TypeScript service
        const tsService = new TypeScriptService(projectRoot);
        const tsExtractor = new TypeScriptExtractor(() => tsService.getProgram(), projectRoot);

        const program = tsService.getProgram();
        if (!program) {
            console.warn('[WebviewDataService] No TypeScript program created - this is expected for non-TS/JS projects');
            console.warn('[WebviewDataService] TypeScript files will not be processed. Other languages use tree-sitter parsers.');
            return;
        }

        // Get all source files (excluding node_modules, declaration files)
        const normalizedRoot = projectRoot.replace(/\\/g, '/');
        const sourceFiles = program.getSourceFiles().filter(sf => {
            const filePath = sf.fileName.replace(/\\/g, '/');
            return !filePath.includes('node_modules') &&
                !filePath.endsWith('.d.ts') &&
                filePath.startsWith(normalizedRoot);
        });

        console.log(`[WebviewDataService] Scanning ${sourceFiles.length} TypeScript files...`);

        // Count total lines in the codebase to determine eager vs lazy mode
        let totalCodebaseLines = 0;
        for (const sf of sourceFiles) {
            totalCodebaseLines += sf.getEnd(); // Approximate line count from source file length
        }

        const isLazyMode = totalCodebaseLines > LAZY_CODEBASE_LINE_THRESHOLD;
        console.log(`[WebviewDataService] Total codebase lines: ~${totalCodebaseLines}, lazy mode: ${isLazyMode} (threshold: ${LAZY_CODEBASE_LINE_THRESHOLD})`);

        let processedCount = 0;

        for (const sf of sourceFiles) {
            const filePath = sf.fileName;
            const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');

            try {
                // In lazy mode, only create file node (edges loaded on demand)
                if (isLazyMode) {
                    const fileNode = {
                        id: relativePath,
                        name: path.basename(filePath),
                        kind: 'file' as const,
                        fileId: relativePath
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
            } catch (e: any) {
                // Silently skip problematic files
            }
        }

        console.log(`[WebviewDataService] Processed ${processedCount} files`);
    }

    /**
     * Collects data using provided split EdgeListStores (for hot reload scenarios).
     */
    static async collectDataWithSplitEdgeLists(
        projectRoot: string,
        importStore: ImportEdgeListStore,
        callStore: CallEdgeListStore,
        artifactRoot?: string
    ): Promise<WebviewData> {
        // Ensure .arch exists
        const archRoot = path.join(projectRoot, '.arch');
        if (!fs.existsSync(archRoot)) {
            try {
                fs.mkdirSync(archRoot, { recursive: true });
            } catch (e) {
                console.error('Failed to create .arch directory:', e);
            }
        }

        // Load watched files state (if artifactRoot provided)
        let watchedFiles: Set<string> | undefined;
        if (artifactRoot) {
            const watchService = new WatchService(artifactRoot, projectRoot);
            await watchService.load();
            const watchedFilesArray = watchService.getWatchedFiles();
            watchedFiles = watchedFilesArray.length > 0 ? new Set(watchedFilesArray) : undefined;
            console.log(`[WebviewDataService] Loaded ${watchedFilesArray.length} watched files`);
        }

        // 1. Graph Data (from provided split edge lists, filtered by watched files)
        const graphData = prepareWebviewDataFromSplitEdgeLists(
            importStore.getData(),
            callStore.getData(),
            watchedFiles
        );

        // 2. Work Tree
        const workTree = await generateWorkTree(projectRoot, projectRoot);

        // 3. Design Docs
        const docManager = new DesignDocManager(projectRoot);
        const designDocs = await docManager.getAllDocsAsync();

        return {
            graphData,
            workTree,
            designDocs
        };
    }

}
