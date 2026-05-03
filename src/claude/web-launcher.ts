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
import { createLogger } from '../common/logger';

const log = createLogger('web-launcher');

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
    /**
     * Absolute path to the directory containing webview assets
     * (`index.html`, `main.js`, `styles/`, `libs/`). When omitted, the
     * launcher discovers it via `<workspaceRoot>/dist/webview` →
     * repo-root probe (walk up from `process.cwd()` looking for a
     * `package.json` whose `name === 'llmem'`) → `<repoRoot>/dist/webview`
     * → `<repoRoot>/src/webview` (development fallback).
     *
     * Loop 21 — replaces the previous compile-relative resolution,
     * which broke under ts-node because the script's directory differs
     * between `src/claude/web-launcher.ts` and the compiled
     * `dist/claude/claude/web-launcher.js`.
     */
    assetRoot?: string;
}

/**
 * Walk up from `process.cwd()` looking for a `package.json` whose
 * `name === 'llmem'`. Returns the first match's directory or `null` if
 * we hit the filesystem root without finding one.
 *
 * Used by `resolveAssetRoot` as a fallback when neither an explicit
 * `assetRoot` nor a `<workspaceRoot>/dist/webview` is available.
 */
export function findRepoRoot(): string | null {
    let current = process.cwd();
    const root = path.parse(current).root;

    while (current !== root) {
        const pkgPath = path.join(current, 'package.json');
        if (fs.existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
                if (pkg && pkg.name === 'llmem') {
                    return current;
                }
            } catch {
                // ignore parse failures, keep walking
            }
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return null;
}

/**
 * Resolve the directory containing webview assets.
 *
 * Priority order (Loop 21):
 *   1. `options.assetRoot` if set and `<assetRoot>/index.html` exists.
 *   2. `<options.workspaceRoot>/dist/webview/index.html`.
 *   3. `<repoRoot>/dist/webview/index.html` (repo found via cwd walk-up).
 *   4. `<repoRoot>/src/webview/index.html` (development fallback; warns).
 *
 * Throws "Webview assets not found" listing every probed path if none
 * resolved. The error deliberately omits any compile-time directory
 * reference — that carries no diagnostic value under the new model.
 */
export function resolveAssetRoot(options: GraphGenerationOptions): string {
    const probed: string[] = [];

    // 1. Explicit assetRoot wins.
    if (options.assetRoot) {
        const indexPath = path.join(options.assetRoot, 'index.html');
        probed.push(`assetRoot: ${indexPath}`);
        if (fs.existsSync(indexPath)) {
            return options.assetRoot;
        }
    }

    // 2. Workspace-root-relative dist/webview.
    if (options.workspaceRoot) {
        const wsAssets = path.join(options.workspaceRoot, 'dist', 'webview');
        const wsIndex = path.join(wsAssets, 'index.html');
        probed.push(`workspaceRoot: ${wsIndex}`);
        if (fs.existsSync(wsIndex)) {
            return wsAssets;
        }
    }

    // 3. Repo-root walk-up from cwd → dist/webview.
    const repoRoot = findRepoRoot();
    if (repoRoot) {
        const repoDist = path.join(repoRoot, 'dist', 'webview');
        const repoDistIndex = path.join(repoDist, 'index.html');
        probed.push(`repoRoot/dist: ${repoDistIndex}`);
        if (fs.existsSync(repoDistIndex)) {
            return repoDist;
        }

        // 4. Development fallback: src/webview (no index.html check —
        // the webview generator can render directly from source). Warn
        // because this means the dev hasn't run `npm run build:webview`.
        const repoSrc = path.join(repoRoot, 'src', 'webview');
        probed.push(`repoRoot/src: ${repoSrc}`);
        if (fs.existsSync(repoSrc)) {
            log.warn(
                'Using src/webview fallback (development only). Run "npm run build:webview" to generate dist/webview.',
                { assetRoot: repoSrc },
            );
            return repoSrc;
        }
    } else {
        probed.push('repoRoot: <not found> (no package.json with name="llmem" walking up from process.cwd())');
    }

    throw new Error(
        `Webview assets not found. Probed (in order):\n` +
        probed.map((p) => `  - ${p}`).join('\n') + '\n' +
        `Pass an explicit \`assetRoot\` option or run "npm run build:webview" to generate dist/webview.`,
    );
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

    // Loop 21 — resolve webview asset root via injected option / cwd
    // walk-up. Replaces the previous compile-time directory arithmetic.
    const webviewRoot = resolveAssetRoot(options);

    // `generateStaticWebview` accepts an `extensionRoot` and re-probes
    // `<extensionRoot>/dist/webview` vs `<extensionRoot>/src/webview`
    // internally. Our resolved `webviewRoot` is one of those two
    // (or an explicit override), so the parent of its parent is the
    // matching extension root. Keeping this derivation rather than
    // changing the generator's signature stays inside Loop 21 scope.
    const extensionRoot = path.resolve(webviewRoot, '..', '..');

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
    const { execFile } = require('child_process');
    let cmd: string;
    let args: string[];
    if (process.platform === 'win32') {
        cmd = 'cmd';
        args = ['/c', 'start', '', url];
    } else if (process.platform === 'darwin') {
        cmd = 'open';
        args = [url];
    } else {
        cmd = 'xdg-open';
        args = [url];
    }
    execFile(cmd, args, (error: any) => {
        if (error) {
            log.warn('Failed to open browser', { error: error.message });
        }
    });
}
