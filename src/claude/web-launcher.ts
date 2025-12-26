/**
 * Web Graph Launcher for Claude Code
 *
 * Generates static HTML graph and provides URLs for browser viewing.
 * This is a helper module that wraps the existing webview generation
 * with Claude-specific path handling.
 */

import * as path from 'path';
import * as fs from 'fs';
import { ImportEdgeListStore, CallEdgeListStore } from '../graph/edgelist';
import { prepareWebviewDataFromSplitEdgeLists } from '../graph/webview-data';
import { generateStaticWebview } from '../webview/generator';
import { WatchService } from '../graph/worktree-state';

/**
 * Options for graph generation
 */
export interface GraphGenerationOptions {
    /** Workspace root directory */
    workspaceRoot: string;
    /** Artifact root directory (default: '.artifacts') */
    artifactRoot?: string;
    /** Only generate graph assets (skip worktree, arch, design docs) */
    graphOnly?: boolean;
}

/**
 * Result of graph generation
 */
export interface GraphGenerationResult {
    /** Absolute path to generated index.html */
    indexPath: string;
    /** file:// URL for opening in browser */
    url: string;
    /** Number of nodes in import graph */
    importNodeCount: number;
    /** Number of edges in import graph */
    importEdgeCount: number;
    /** Number of nodes in call graph */
    callNodeCount: number;
    /** Number of edges in call graph */
    callEdgeCount: number;
}

/**
 * Generate static HTML graph for browser viewing
 *
 * This function:
 * 1. Loads edge lists from artifact directory
 * 2. Builds graph data structures
 * 3. Generates static HTML webview
 * 4. Returns file:// URL for browser
 *
 * @param options - Graph generation options
 * @returns Graph generation result with URL
 * @throws Error if edge lists not found or generation fails
 */
export async function generateGraph(
    options: GraphGenerationOptions
): Promise<GraphGenerationResult> {
    const { workspaceRoot, artifactRoot = '.artifacts', graphOnly = false } = options;

    // Validate workspace root
    if (!fs.existsSync(workspaceRoot)) {
        throw new Error(`Workspace root does not exist: ${workspaceRoot}`);
    }

    const artifactDir = path.join(workspaceRoot, artifactRoot);

    // Check if edge lists exist (split format)
    const importEdgeListPath = path.join(artifactDir, 'import-edgelist.json');
    const callEdgeListPath = path.join(artifactDir, 'call-edgelist.json');

    if (!fs.existsSync(importEdgeListPath) || !fs.existsSync(callEdgeListPath)) {
        throw new Error(
            `Edge lists not found in ${artifactDir}. ` +
            `Expected: import-edgelist.json and call-edgelist.json. ` +
            `Please scan the workspace first to generate the graph data.`
        );
    }

    // Load split edge lists
    const importStore = new ImportEdgeListStore(artifactDir);
    const callStore = new CallEdgeListStore(artifactDir);

    await importStore.load();
    await callStore.load();

    const importData = importStore.getData();
    const callData = callStore.getData();

    // Load watched files state
    const watchService = new WatchService(artifactDir, workspaceRoot);
    await watchService.load();
    const watchedFiles = new Set(watchService.getWatchedFiles());

    // Prepare graph data for visualization (filtered by watched files)
    const graphData = prepareWebviewDataFromSplitEdgeLists(importData, callData, watchedFiles);

    // Determine extension root (where webview files are located)
    // Priority: 1) dist/webview (portable), 2) src/webview (development)
    // When running from dist/claude/claude/index.js, extension root is ../../../
    const extensionRoot = path.resolve(__dirname, '..', '..', '..');

    // Check for webview in dist/ first (portable CLI), then src/ (development)
    const distWebview = path.join(extensionRoot, 'dist', 'webview');
    const srcWebview = path.join(extensionRoot, 'src', 'webview');

    let webviewRoot: string;
    if (fs.existsSync(distWebview) && fs.existsSync(path.join(distWebview, 'index.html'))) {
        // Use dist/webview for portable CLI
        webviewRoot = distWebview;
    } else if (fs.existsSync(srcWebview)) {
        // Fall back to src/webview for development
        webviewRoot = srcWebview;
    } else {
        throw new Error(
            `Webview files not found. Checked:\n` +
            `  - dist/webview at: ${distWebview}\n` +
            `  - src/webview at: ${srcWebview}\n` +
            `Current __dirname: ${__dirname}\n` +
            `Run 'npm run build:webview' to generate dist/webview files.`
        );
    }

    // Generate static webview
    const webviewDir = path.join(artifactDir, 'webview');
    const indexPath = await generateStaticWebview(
        webviewDir,
        extensionRoot,
        workspaceRoot,
        graphData,
        { graphOnly: false },  // Always generate full 3-panel UI
        watchService.getWatchedFiles()  // Pass watched files for UI initialization
    );

    // Convert to file:// URL (normalize slashes for cross-platform)
    const url = `file://${indexPath.replace(/\\/g, '/')}`;

    return {
        indexPath,
        url,
        importNodeCount: graphData.importGraph.nodes.length,
        importEdgeCount: graphData.importGraph.edges.length,
        callNodeCount: graphData.callGraph.nodes.length,
        callEdgeCount: graphData.callGraph.edges.length,
    };
}

/**
 * Check if edge lists exist for a workspace
 *
 * @param workspaceRoot - Workspace root directory
 * @param artifactRoot - Artifact root (default: '.artifacts')
 * @returns True if edge lists exist
 */
export function hasEdgeLists(
    workspaceRoot: string,
    artifactRoot: string = '.artifacts'
): boolean {
    const artifactDir = path.join(workspaceRoot, artifactRoot);
    const importEdgeListPath = path.join(artifactDir, 'import-edgelist.json');
    const callEdgeListPath = path.join(artifactDir, 'call-edgelist.json');
    return fs.existsSync(importEdgeListPath) && fs.existsSync(callEdgeListPath);
}

/**
 * Get edge list statistics without generating graph
 *
 * @param workspaceRoot - Workspace root directory
 * @param artifactRoot - Artifact root (default: '.artifacts')
 * @returns Statistics about the edge lists
 */
export async function getGraphStats(
    workspaceRoot: string,
    artifactRoot: string = '.artifacts'
): Promise<{
    importNodes: number;
    importEdges: number;
    callNodes: number;
    callEdges: number;
    fileCount: number;
    lastUpdated: string;
}> {
    const artifactDir = path.join(workspaceRoot, artifactRoot);

    const importStore = new ImportEdgeListStore(artifactDir);
    const callStore = new CallEdgeListStore(artifactDir);

    await importStore.load();
    await callStore.load();

    const importData = importStore.getData();
    const callData = callStore.getData();

    // Count unique files from import data
    const fileIds = new Set<string>();
    for (const node of importData.nodes) {
        fileIds.add(node.fileId);
    }

    return {
        importNodes: importData.nodes.length,
        importEdges: importData.edges.length,
        callNodes: callData.nodes.length,
        callEdges: callData.edges.length,
        fileCount: fileIds.size,
        lastUpdated: importData.timestamp,
    };
}

/**
 * Open graph in default browser (platform-specific)
 *
 * Note: This requires child_process and may not work in all environments.
 * Recommend returning URL to Claude and letting user open it.
 *
 * @param url - file:// URL to open
 */
export function openInBrowser(url: string): void {
    const { exec } = require('child_process');
    const command =
        process.platform === 'win32'
            ? 'start'
            : process.platform === 'darwin'
                ? 'open'
                : 'xdg-open';

    exec(`${command} "${url}"`, (error: any) => {
        if (error) {
            console.error(`Failed to open browser: ${error.message}`);
        }
    });
}
