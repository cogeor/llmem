import * as fs from 'fs';
import * as path from 'path';
import { generateWorkTree, ITreeNode } from './worktree';
import { prepareWebviewDataFromEdgeList, WebviewGraphData } from '../graph/webview-data';
import { DesignDocManager } from './design-docs';
import { EdgeListStore } from '../graph/edgelist';
import { TypeScriptService } from '../parser/ts-service';
import { TypeScriptExtractor } from '../parser/ts-extractor';
import { artifactToEdgeList } from '../graph/artifact-converter';

export interface WebviewData {
    graphData: WebviewGraphData;
    workTree: ITreeNode;
    designDocs: { [key: string]: string };
}

/**
 * Service to aggregate all data needed for the webview.
 * Shared by both the static generator and the vscode extension.
 */
export class WebviewDataService {

    /**
     * Collects all data required for the webview.
     * If edgelist.json doesn't exist, scans the codebase and creates it.
     * 
     * @param projectRoot Root directory of the project to analyze
     * @param artifactRoot Root directory for edgelist.json (e.g. .artifacts)
     */
    static async collectData(projectRoot: string, artifactRoot: string): Promise<WebviewData> {

        // Ensure artifact root exists
        if (!fs.existsSync(artifactRoot)) {
            fs.mkdirSync(artifactRoot, { recursive: true });
        }

        // Load or generate edge list
        const edgeListStore = new EdgeListStore(artifactRoot);
        const edgeListPath = path.join(artifactRoot, 'edgelist.json');

        if (fs.existsSync(edgeListPath)) {
            // Edge list exists - just load it
            await edgeListStore.load();
            console.log('[WebviewDataService] Loaded existing edge list');
        } else {
            // Edge list doesn't exist - scan codebase and create it
            console.log('[WebviewDataService] Edge list not found, scanning codebase...');
            try {
                await this.scanAndPopulateEdgeList(projectRoot, edgeListStore);
                await edgeListStore.save();
                console.log('[WebviewDataService] Edge list created and saved');
            } catch (scanError) {
                console.error('[WebviewDataService] Failed to scan codebase:', scanError);
                console.log('[WebviewDataService] Continuing with empty edge list');
            }
        }

        const stats = edgeListStore.getStats();
        console.log(`[WebviewDataService] Edge list: ${stats.nodes} nodes, ${stats.edges} edges`);

        // Ensure .arch exists
        const archRoot = path.join(projectRoot, '.arch');
        if (!fs.existsSync(archRoot)) {
            try {
                fs.mkdirSync(archRoot, { recursive: true });
            } catch (e) {
                console.error('Failed to create .arch directory:', e);
            }
        }

        // 1. Graph Data (from edge list)
        const graphData = prepareWebviewDataFromEdgeList(edgeListStore.getData());
        console.log(`[WebviewDataService] Graph data prepared: import ${graphData.importGraph.nodes.length} nodes, call ${graphData.callGraph.nodes.length} nodes`);

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

    /**
     * Scan codebase and populate edge list with TypeScript files.
     */
    private static async scanAndPopulateEdgeList(
        projectRoot: string,
        edgeListStore: EdgeListStore
    ): Promise<void> {
        // Initialize TypeScript service
        const tsService = new TypeScriptService(projectRoot);
        const tsExtractor = new TypeScriptExtractor(() => tsService.getProgram(), projectRoot);

        const program = tsService.getProgram();
        if (!program) {
            console.error('[WebviewDataService] Failed to create TypeScript program');
            return;
        }

        // Get all source files (excluding node_modules, declaration files)
        // Normalize projectRoot for comparison (TS compiler may use forward slashes)
        const normalizedRoot = projectRoot.replace(/\\/g, '/');
        const sourceFiles = program.getSourceFiles().filter(sf => {
            const filePath = sf.fileName.replace(/\\/g, '/');
            return !filePath.includes('node_modules') &&
                !filePath.endsWith('.d.ts') &&
                filePath.startsWith(normalizedRoot);
        });

        console.log(`[WebviewDataService] Scanning ${sourceFiles.length} TypeScript files...`);

        let processedCount = 0;
        for (const sf of sourceFiles) {
            const filePath = sf.fileName;
            const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');

            try {
                const artifact = await tsExtractor.extract(filePath);
                if (!artifact) continue;

                const { nodes, edges } = artifactToEdgeList(artifact, relativePath);
                edgeListStore.addNodes(nodes);
                edgeListStore.addEdges(edges);
                processedCount++;
            } catch (e: any) {
                console.warn(`[WebviewDataService] Skip ${relativePath}: ${e.message}`);
            }
        }

        console.log(`[WebviewDataService] Processed ${processedCount} files`);
    }

    /**
     * Collects data using a provided EdgeListStore (for hot reload scenarios).
     */
    static async collectDataWithEdgeList(
        projectRoot: string,
        edgeListStore: EdgeListStore
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

        // 1. Graph Data (from provided edge list)
        const graphData = prepareWebviewDataFromEdgeList(edgeListStore.getData());

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
