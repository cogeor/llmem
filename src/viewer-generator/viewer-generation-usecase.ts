/**
 * Static-graph generation use-case for the Claude web launcher (Loop 15
 * split).
 *
 * Carved verbatim from the former `web-launcher.ts` monolith: the public
 * `GraphGenerationOptions` / `GraphGenerationResult` shapes and the
 * `generateGraph` flow that loads edge lists, builds folder artifacts,
 * prepares webview data, resolves the asset root, and writes the static
 * webview.
 *
 * Re-exported through the `web-launcher.ts` barrel so existing import sites
 * keep working unchanged.
 */

import * as path from 'path';
import * as fs from 'fs';
import { ImportEdgeListStore, CallEdgeListStore, SchemaMismatchError } from '../graph/edgelist';
import { prepareWebviewDataFromSplitEdgeLists } from '../graph/webview-data';
import { generateStaticWebview } from '../webview/generator';
import { WatchService } from '../graph/worktree-state';
import { createLogger } from '../common/logger';
import { buildAndSaveFolderArtifacts } from '../application/folder-artifacts';
import { buildHealthOverlay } from '../application/analysis/webview-overlay';
import { rescanAfterSchemaMismatch } from '../application/scan';
import { initWorkspaceContext, type WorkspaceContext } from '../application/workspace-context';
import { resolveAssetRoot } from './asset-root-resolver';

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
    /** Artifact root directory (default: DEFAULT_CONFIG.artifactRoot). Ignored when `ctx` is supplied. */
    artifactRoot?: string;
    /** Only generate graph assets (skip worktree, arch, design docs) */
    graphOnly?: boolean;
    /**
     * Absolute path to the directory containing webview assets
     * (`index.html`, `main.js`, `styles/`, `libs/`). When omitted, the
     * launcher discovers it via `<workspaceRoot>/dist/webview` →
     * repo-root probe (walk up from `process.cwd()` looking for a
     * `package.json` whose `name === '@cogeor/llmem'`) → `<repoRoot>/dist/webview`
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
        // Standalone invocation (no host-supplied ctx): this usecase reads
        // design docs, so when it builds its own context it acts as the host
        // entry and must run the one-time `.arch` -> `.llmem/docs` migration.
        ctx = await initWorkspaceContext({
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
    const importStore = new ImportEdgeListStore(artifactDir, ctx.artifactIo);
    const callStore = new CallEdgeListStore(artifactDir, ctx.artifactIo);

    // Loop 13 (codebase-quality-v2): the persisted envelope may be
    // pre-resolver-swap. Catch SchemaMismatchError, rescan into v_next
    // envelopes, then retry the loads.
    try {
        await importStore.load();
        await callStore.load();
    } catch (e) {
        if (!(e instanceof SchemaMismatchError)) throw e;
        log.warn('Edge-list schema mismatch in generateGraph — rescanning', { artifactDir });
        await rescanAfterSchemaMismatch(ctx);
        await importStore.load();
        await callStore.load();
    }

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
    const watchService = new WatchService(artifactDir, ctx.workspaceRoot, ctx.io, ctx.artifactIo);
    await watchService.load();
    const watchedFiles = new Set(watchService.getWatchedFiles());

    // Loop 08: assemble the health overlay (clone edges + node smells) from the
    // persisted clone-edgelist + cheap hub arithmetic. Tolerant — empty when
    // artifacts are absent.
    const health = await buildHealthOverlay(ctx);

    // Prepare graph data for visualization. An EMPTY watched set means "nothing
    // pinned yet" (e.g. a fresh `serve` on a newly-scanned repo) and must render
    // the FULL graph — passing the empty Set as a filter would exclude every
    // node. Mirror viewer-data.ts: fall back to `undefined` (no filter) when the
    // set is empty. Only a non-empty set narrows the view to pinned files.
    const graphData = prepareWebviewDataFromSplitEdgeLists(
        importData,
        callData,
        watchedFiles.size > 0 ? watchedFiles : undefined,
        health,
    );

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
