/**
 * Web Graph Launcher for Claude Code
 *
 * Generates static HTML graph and provides URLs for browser viewing.
 * This is a helper module that wraps the existing webview generation
 * with Claude-specific path handling.
 *
 * Loop 04: callers may now pass `ctx: WorkspaceContext` instead of the
 * loose `{ workspaceRoot, artifactRoot }` triple. When `ctx` is supplied,
 * the launcher reuses it everywhere; otherwise it constructs one inline
 * for backward-compat with CLI-style call sites.
 */

import * as path from 'path';
import * as fs from 'fs';
import { ImportEdgeListStore, CallEdgeListStore } from '../graph/edgelist';
import { prepareWebviewDataFromSplitEdgeLists } from '../graph/webview-data';
import { generateStaticWebview } from '../webview/generator';
import { WatchService } from '../graph/worktree-state';
import { createLogger } from '../common/logger';
import { buildAndSaveFolderArtifacts } from '../application/folder-artifacts';
import { createWorkspaceContext, type WorkspaceContext } from '../application/workspace-context';

const log = createLogger('web-launcher');

/**
 * Options for graph generation
 *
 * Two call shapes:
 *   1. Loose — `{ workspaceRoot, artifactRoot? }`. The launcher builds
 *      its own `WorkspaceContext` inline. CLI commands use this.
 *   2. With `ctx` — the caller has already built a `WorkspaceContext`
 *      and the launcher reuses it. The HTTP server's regenerator uses
 *      this so the long-lived `WorkspaceIO` is shared.
 *
 * Both shapes accept the optional `assetRoot` and `graphOnly`.
 */
export interface GraphGenerationOptions {
    /** Workspace root directory. Required for the loose call shape; ignored when `ctx` is supplied. */
    workspaceRoot?: string;
    /** Artifact root directory (default: '.artifacts'). Ignored when `ctx` is supplied. */
    artifactRoot?: string;
    /** Only generate graph assets (skip worktree, arch, design docs) */
    graphOnly?: boolean;
    /**
     * Absolute path to the directory containing webview assets
     * (`index.html`, `main.js`, `styles/`, `libs/`). When omitted, the
     * launcher discovers it via `<workspaceRoot>/dist/webview` →
     * repo-root probe (walk up from `process.cwd()` looking for a
     * `package.json` whose `name === 'llmem'`) → `<repoRoot>/dist/webview`
     * → install-root probe (walk up from this file's `__dirname` looking
     * for the same `package.json`) → `<installedRoot>/dist/webview` →
     * `<repoRoot>/src/webview` (development fallback). The install-root
     * step is what makes a global `npm i -g llmem` install work without
     * `LLMEM_ASSET_ROOT` set.
     */
    assetRoot?: string;
    /**
     * Optional `WorkspaceContext` (Loop 04). When supplied, the launcher
     * reuses it for the folder-artifact step and any other workspace I/O,
     * skipping the `createWorkspaceContext` call.
     *
     * The CLI commands (`serve`, `generate`) call `generateGraph` without
     * a context and rely on the inline construction. The server's
     * regenerator passes its long-lived context through to avoid duplicate
     * canonicalization on every file-watcher event.
     */
    ctx?: WorkspaceContext;
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
    return findLlmemPackageRoot(process.cwd());
}

/**
 * Walk up from this file's directory looking for a `package.json` whose
 * `name === 'llmem'`. Reliably finds the install root when llmem is run
 * from a global npm install (where cwd is the user's repo, not ours).
 *
 * In dev (ts-node) this resolves `<repo>/src/claude` → `<repo>`.
 * In compiled CommonJS this resolves `<install>/dist/claude` → `<install>`.
 * For global npm installs `<install>` is e.g.
 * `<global>/lib/node_modules/llmem`, whose `package.json` carries
 * `name === 'llmem'` so the walk-up matches.
 *
 * Returns null if the walk hits the filesystem root without finding it.
 */
export function findInstalledPackageRoot(): string | null {
    // CommonJS — `__dirname` is universal. (tsconfig.base.json sets
    // `module: commonjs`.) If the project ever switches to ESM, swap to
    // `path.dirname(fileURLToPath(import.meta.url))`.
    return findLlmemPackageRoot(__dirname);
}

/**
 * Test seam: `resolveAssetRoot` calls through these references rather
 * than the exported helpers directly so unit tests can override either
 * walk-up. Setting both to functions returning `null` lets tests
 * exercise the "nothing resolves" failure path even when running from
 * inside the real llmem checkout (where `__dirname` would otherwise
 * always find a valid `dist/webview`).
 *
 * Production code should never touch these — use the exported helpers.
 */
export const __testHooks = {
    findRepoRoot: (): string | null => findRepoRoot(),
    findInstalledPackageRoot: (): string | null => findInstalledPackageRoot(),
};

/**
 * Shared walk-up: starting from `from`, climb the directory tree looking
 * for a `package.json` whose `name === 'llmem'`. Returns the first
 * match's directory or `null` on filesystem-root miss.
 */
function findLlmemPackageRoot(from: string): string | null {
    let current = from;
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
 * Priority order:
 *   1. `options.assetRoot` if set and `<assetRoot>/index.html` exists.
 *   2. `<options.workspaceRoot>/dist/webview/index.html`.
 *   3. `<repoRoot>/dist/webview/index.html` (repo found via cwd walk-up;
 *      canonical path for dev workflows where the user is editing llmem
 *      itself, so cwd-relative resolution stays primary).
 *   4. `<installedRoot>/dist/webview/index.html` (install dir found via
 *      `__dirname` walk-up; this is the global-npm-install path — cwd is
 *      the user's repo, not ours, so the cwd walk in (3) misses).
 *   5. `<repoRoot>/src/webview/index.html` (development fallback; warns).
 *
 * Throws "Webview assets not found" listing every probed path if none
 * resolved. The error deliberately omits any compile-time directory
 * reference — that carries no diagnostic value under the new model.
 */
export function resolveAssetRoot(opts: { workspaceRoot?: string; assetRoot?: string }): string {
    const probed: string[] = [];

    // 1. Explicit assetRoot wins.
    if (opts.assetRoot) {
        const indexPath = path.join(opts.assetRoot, 'index.html');
        probed.push(`assetRoot: ${indexPath}`);
        if (fs.existsSync(indexPath)) {
            return opts.assetRoot;
        }
    }

    // 2. Workspace-root-relative dist/webview.
    if (opts.workspaceRoot) {
        const wsAssets = path.join(opts.workspaceRoot, 'dist', 'webview');
        const wsIndex = path.join(wsAssets, 'index.html');
        probed.push(`workspaceRoot: ${wsIndex}`);
        if (fs.existsSync(wsIndex)) {
            return wsAssets;
        }
    }

    // 3. Repo-root walk-up from cwd → dist/webview. Canonical path for
    // dev (running llmem from its own checkout).
    const repoRoot = __testHooks.findRepoRoot();
    if (repoRoot) {
        const repoDist = path.join(repoRoot, 'dist', 'webview');
        const repoDistIndex = path.join(repoDist, 'index.html');
        probed.push(`repoRoot/dist: ${repoDistIndex}`);
        if (fs.existsSync(repoDistIndex)) {
            return repoDist;
        }
    } else {
        probed.push('repoRoot: <not found> (no package.json with name="llmem" walking up from process.cwd())');
    }

    // 4. Install-root walk-up from `__dirname` → dist/webview. Catches
    // the global-npm-install case: cwd is the user's repo, but our
    // compiled `web-launcher.js` lives under the install dir.
    const installedRoot = __testHooks.findInstalledPackageRoot();
    if (installedRoot) {
        const installDist = path.join(installedRoot, 'dist', 'webview');
        const installDistIndex = path.join(installDist, 'index.html');
        probed.push(`installedRoot/dist: ${installDistIndex}`);
        if (fs.existsSync(installDistIndex)) {
            return installDist;
        }
    } else {
        probed.push('installedRoot: <not found> (no package.json with name="llmem" walking up from this module\'s install location)');
    }

    // 5. Development fallback: src/webview (no index.html check —
    // the webview generator can render directly from source). Warn
    // because this means the dev hasn't run `npm run build:webview`.
    if (repoRoot) {
        const repoSrc = path.join(repoRoot, 'src', 'webview');
        probed.push(`repoRoot/src: ${repoSrc}`);
        if (fs.existsSync(repoSrc)) {
            log.warn(
                'Using src/webview fallback (development only). Run "npm run build:webview" to generate dist/webview.',
                { assetRoot: repoSrc },
            );
            return repoSrc;
        }
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
    const { graphOnly = false } = options;
    void graphOnly;

    // Loop 04: build (or reuse) the WorkspaceContext.
    let ctx: WorkspaceContext;
    if (options.ctx) {
        ctx = options.ctx;
    } else {
        if (!options.workspaceRoot) {
            throw new Error('generateGraph: must supply either `ctx` or `workspaceRoot`');
        }
        // Validate workspace root early (the factory will too, but this
        // preserves the prior message shape for tests asserting on the
        // CLI failure mode).
        if (!fs.existsSync(options.workspaceRoot)) {
            throw new Error(`Workspace root does not exist: ${options.workspaceRoot}`);
        }
        ctx = await createWorkspaceContext({
            workspaceRoot: options.workspaceRoot,
            configOverrides: options.artifactRoot
                ? { artifactRoot: options.artifactRoot }
                : undefined,
        });
    }

    const artifactDir = ctx.artifactRoot;

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
    const importStore = new ImportEdgeListStore(artifactDir, ctx.io);
    const callStore = new CallEdgeListStore(artifactDir, ctx.io);

    await importStore.load();
    await callStore.load();

    const importData = importStore.getData();
    const callData = callStore.getData();

    // Loop 11 followup — emit folder-tree.json + folder-edgelist.json next
    // to the edge lists. Mirrors the call shape used previously by
    // `regenerator.ts:regenerateWebview`: same options object, same
    // fail-loud posture (a thrown aggregator aborts `generateGraph`
    // before the static webview is written, so we never publish a
    // webview whose folder-tree/edges script tags reference missing JSON).
    //
    // Placement: AFTER the edge-list load (so we know the source data
    // exists and is valid) and BEFORE the static-generate step (so loop
    // 11's static generator can read the artifacts when it emits the
    // `folder_tree.js` / `folder_edges.js` script tags).
    //
    // The regenerator path (`regenerator.ts`) used to call this helper
    // separately; that call has been removed to avoid double-emit per
    // user action. Direct `bin/llmem scan` continues to call the helper
    // itself (it does not go through `generateGraph`).
    await buildAndSaveFolderArtifacts(ctx);

    // Load watched files state
    const watchService = new WatchService(artifactDir, ctx.workspaceRoot, ctx.io);
    await watchService.load();
    const watchedFiles = new Set(watchService.getWatchedFiles());

    // Prepare graph data for visualization (filtered by watched files)
    const graphData = prepareWebviewDataFromSplitEdgeLists(importData, callData, watchedFiles);

    // Loop 21 — resolve webview asset root via injected option / cwd
    // walk-up. Replaces the previous compile-time directory arithmetic.
    const webviewRoot = resolveAssetRoot({
        workspaceRoot: ctx.workspaceRoot,
        assetRoot: options.assetRoot,
    });

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
        ctx.workspaceRoot,
        graphData,
        { graphOnly: false },  // Always generate full 3-panel UI
        watchService.getWatchedFiles(),  // Pass watched files for UI initialization
        ctx,  // Loop 04: share the launcher's context with the static generator
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
 * Loop 04: takes a `WorkspaceContext` instead of
 * `(workspaceRoot, artifactRoot?)`.
 *
 * @param ctx - WorkspaceContext for the target workspace
 * @returns Statistics about the edge lists
 */
export async function getGraphStats(
    ctx: WorkspaceContext,
): Promise<{
    importNodes: number;
    importEdges: number;
    callNodes: number;
    callEdges: number;
    fileCount: number;
    lastUpdated: string;
}> {
    const artifactDir = ctx.artifactRoot;

    const importStore = new ImportEdgeListStore(artifactDir, ctx.io);
    const callStore = new CallEdgeListStore(artifactDir, ctx.io);

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
