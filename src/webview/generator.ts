
import * as fs from 'fs-extra';
import * as path from 'path';
// NOTE: esbuild is lazy-loaded to avoid errors when not installed (e.g., in bundled MCP server)
import { generateWorkTree } from './worktree';
import { convertAllMarkdown } from './utils/md-converter';
import { loadDesignDocs } from './design-docs';
import { createLogger } from '../common/logger';
import { createWorkspaceContext, type WorkspaceContext } from '../application/workspace-context';
import { FolderTreeStore } from '../graph/folder-tree-store';
import { FolderEdgelistStore } from '../graph/folder-edges-store';
import { renderShell, type ShellHostHooks } from './shell';
import { computeShellHash, invalidateIfStale, writeCachedShellHash } from './shell-cache';

/**
 * Static-generator output ownership (per CLAUDE.md):
 *   This module writes the following files into `<destinationDir>`:
 *     - `graph_data.js`    — `window.GRAPH_DATA = ...`
 *     - `work_tree.js`     — `window.WORK_TREE = ...`         (skipped in graphOnly)
 *     - `design_docs.js`   — `window.DESIGN_DOCS = ...`        (skipped in graphOnly)
 *     - `folder_tree.js`   — `window.FOLDER_TREE = ...`        (loop 11)
 *     - `folder_edges.js`  — `window.FOLDER_EDGES = ...`       (loop 11)
 *
 * The `.artifacts/webview/` output directory is treated as a cache by
 * `npm run serve` and the extension. Loop 01 added a content-hash
 * invalidation guard (`src/webview/shell-cache.ts`) — when `shell.ts`,
 * `shell-assets.ts`, or any bundled asset under `dist/webview/` changes,
 * `generateStaticWebview` removes the cached directory before regenerating.
 * The previous "DELETE `.artifacts/webview/` by hand" step is no longer
 * required.
 */

const log = createLogger('webview-generator');

/**
 * Options for the static webview generator
 */
export interface GeneratorOptions {
    /** If true, only generate graph-related assets (skip worktree, arch, design docs) */
    graphOnly?: boolean;
}

/**
 * Generate a static webview folder in the artifacts directory.
 *
 * @param destinationDir - The directory where the static webview should be generated (e.g., .artifacts/webview)
 * @param extensionRoot - The root of the extension (to find source src/webview files)
 * @param graphData - The graph data object to inject
 * @param options - Optional generator configuration
 * @param watchedFiles - Optional array of watched file paths to initialize UI state
 * @returns The absolute path to the generated index.html
 */
export async function generateStaticWebview(
    destinationDir: string,
    extensionRoot: string,
    workspaceRoot: string,
    graphData: any,
    options: GeneratorOptions = {},
    watchedFiles?: string[],
    ctx?: WorkspaceContext,
): Promise<string> {

    const { graphOnly = false } = options;

    // Loop 04: prefer the caller-supplied context (the launcher / panel
    // already paid the realpath cost); fall back to a fresh
    // `createWorkspaceContext` call for static-only callers (one-off CLI
    // tests). The `WorkspaceIO` is only used for read-side calls
    // (`generateWorkTree`, `loadDesignDocs`); writes go through `fs-extra`.
    const resolvedCtx = ctx ?? (await createWorkspaceContext({ workspaceRoot }));
    const io = resolvedCtx.io;

    // Ensure destination exists
    if (!fs.existsSync(destinationDir)) {
        fs.mkdirSync(destinationDir, { recursive: true });
    }

    // Loop 01: content-hash invalidation guard. Hash `shell.ts`,
    // `shell-assets.ts`, and every bundled asset under `dist/webview/`
    // (or the source styles/libs/ui directories in dev mode), then
    // remove the cached destination directory if it differs from the
    // recorded hash. After the regeneration completes below we record
    // the new hash. This replaces the legacy "delete `.artifacts/webview/`
    // by hand" developer step; see `src/webview/shell-cache.ts`.
    const shellHash = computeShellHash(extensionRoot);
    const wasStale = invalidateIfStale(destinationDir, shellHash);
    if (wasStale) {
        log.info('Shell hash changed; cached webview directory invalidated', {
            destinationDir,
        });
        fs.mkdirSync(destinationDir, { recursive: true });
    }

    // Determine webview source - check dist/webview first (portable), then src/webview (dev)
    const distWebview = path.join(extensionRoot, 'dist', 'webview');
    const srcWebview = path.join(extensionRoot, 'src', 'webview');
    const useDistWebview = fs.existsSync(distWebview) && fs.existsSync(path.join(distWebview, 'index.html'));
    const webviewRoot = useDistWebview ? distWebview : srcWebview;

    // 1. Copy Assets
    // We need styles/ and libs/vis-network.min.js

    // Copy styles folder
    const stylesSrc = path.join(webviewRoot, 'styles');
    const stylesDest = path.join(destinationDir, 'styles');
    if (fs.existsSync(stylesSrc)) {
        fs.cpSync(stylesSrc, stylesDest, { recursive: true });
    } else {
        log.warn('styles folder not found', { stylesSrc });
    }

    // 2. Bundle or copy Webview UI
    log.info('Bundling webview UI...');
    const jsDir = path.join(destinationDir, 'js');
    if (!fs.existsSync(jsDir)) {
        fs.mkdirSync(jsDir, { recursive: true });
    }

    if (useDistWebview) {
        // Copy pre-bundled main.js from dist/webview
        const bundledJs = path.join(distWebview, 'main.js');
        if (fs.existsSync(bundledJs)) {
            fs.copyFileSync(bundledJs, path.join(jsDir, 'main.js'));
            const bundledMap = path.join(distWebview, 'main.js.map');
            if (fs.existsSync(bundledMap)) {
                fs.copyFileSync(bundledMap, path.join(jsDir, 'main.js.map'));
            }
        } else {
            log.warn('pre-bundled main.js not found', { bundledJs });
        }
    } else {
        // Bundle from source TypeScript
        // Lazy-load esbuild to avoid errors when not installed
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const esbuild = require('esbuild');
            await esbuild.build({
                entryPoints: [path.join(srcWebview, 'ui', 'main.ts')],
                bundle: true,
                outfile: path.join(jsDir, 'main.js'),
                platform: 'browser',
                target: 'es2020',
                sourcemap: true,
                minify: false, // Easier debugging
                format: 'iife', // Use IIFE for file:// support (no CORS on modules)
            });
        } catch (e) {
            log.error('Esbuild failed', {
                error: e instanceof Error ? e.message : String(e),
            });
            throw e;
        }
    }

    // Copy libs
    const libsSrc = path.join(webviewRoot, 'libs');
    const libsDest = path.join(destinationDir, 'libs');
    if (fs.existsSync(libsSrc)) {
        fs.cpSync(libsSrc, libsDest, { recursive: true });
    } else {
        log.warn('libs folder not found', { libsSrc });
    }

    // 3. Copy .arch folder to arch (skip in graph-only mode)
    const archSrc = path.join(workspaceRoot, '.arch');
    const archDest = path.join(destinationDir, 'arch');
    if (!graphOnly) {
        if (fs.existsSync(archSrc)) {
            if (!fs.existsSync(archDest)) {
                fs.mkdirSync(archDest, { recursive: true });
            }
            // Simple recursive copy
            fs.cpSync(archSrc, archDest, { recursive: true });

            // Convert Markdown to HTML
            await convertAllMarkdown(archDest);
        } else {
            log.warn('.arch folder not found', { archSrc });
        }
    }

    // 4. Generate Folder Tree (skip in graph-only mode)
    // Use workspace root for the tree - don't assume 'src/' exists
    if (!graphOnly) {
        const workTree = await generateWorkTree(io);
        const treePath = path.join(destinationDir, 'work_tree.js');
        const treeContent = `window.WORK_TREE = ${JSON.stringify(workTree, null, 2)};`;
        fs.writeFileSync(treePath, treeContent, 'utf8');
    }

    // 5. Render the host HTML via the shared shell renderer (loop 01).
    //    Both the static generator and the VS Code panel now go through
    //    `renderShell` so the mount-point set, stylesheet manifest, and
    //    library list cannot drift between hosts. We build the static-mode
    //    host hooks (identity URL resolution — relative URLs work because
    //    the generated `index.html` sits next to `styles/`, `libs/`, `js/`)
    //    and pass them in below after we know which data scripts to embed.

    // Write graph data to JS file
    const graphDataPath = path.join(destinationDir, 'graph_data.js');
    let graphDataContent = `window.GRAPH_DATA = ${JSON.stringify(graphData, null, 2)};`;

    // Add watched files if provided
    if (watchedFiles && watchedFiles.length > 0) {
        graphDataContent += `\nwindow.WATCHED_FILES = ${JSON.stringify(watchedFiles, null, 2)};`;
    }

    fs.writeFileSync(graphDataPath, graphDataContent, 'utf8');

    // 5b. Folder tree + folder edges (loop 11).
    //
    // Loop 10 guarantees `.artifacts/folder-tree.json` and `.artifacts/folder-edgelist.json`
    // are on disk by the time this generator runs: every upstream call site
    // (`src/claude/web-launcher.ts:generateGraph`, `src/claude/cli/commands/scan.ts`)
    // calls `buildAndSaveFolderArtifacts` before invoking the generator.
    //
    // The artifact-dir convention is one segment up from `destinationDir` —
    // production callers pass `<workspaceRoot>/<artifactRoot>/webview`, so
    // the JSONs live in the parent directory. Resolve via `path.dirname(destinationDir)`
    // rather than re-deriving the workspace root, so the function stays
    // single-source-of-truth on its `destinationDir` argument.
    const artifactDir = path.dirname(destinationDir);

    const folderTree = await new FolderTreeStore(artifactDir, io).load();
    const folderEdges = await new FolderEdgelistStore(artifactDir, io).load();

    const folderTreePath = path.join(destinationDir, 'folder_tree.js');
    const folderTreeContent = `window.FOLDER_TREE = ${JSON.stringify(folderTree, null, 2)};`;
    fs.writeFileSync(folderTreePath, folderTreeContent, 'utf8');

    const folderEdgesPath = path.join(destinationDir, 'folder_edges.js');
    const folderEdgesContent = `window.FOLDER_EDGES = ${JSON.stringify(folderEdges, null, 2)};`;
    fs.writeFileSync(folderEdgesPath, folderEdgesContent, 'utf8');

    // 6. Bundle Design Docs (skip in graph-only mode)
    if (!graphOnly) {
        const designDocs = await loadDesignDocs(workspaceRoot, io);
        const designDocsPath = path.join(destinationDir, 'design_docs.js');
        const designDocsContent = `window.DESIGN_DOCS = ${JSON.stringify(designDocs, null, 2)};`;
        fs.writeFileSync(designDocsPath, designDocsContent, 'utf8');
    }

    // Compose the data-script URL list. Same conditional that historically
    // built the inline `injectionScript`. The renderer emits a classic
    // `<script src=...>` per entry (no `type="module"`; the bundle uses
    // IIFE for `file://` compatibility).
    const dataScriptUrls: readonly string[] = graphOnly
        ? ['graph_data.js', 'folder_tree.js', 'folder_edges.js']
        : ['graph_data.js', 'work_tree.js', 'design_docs.js', 'folder_tree.js', 'folder_edges.js'];

    // Identity host hooks — the generated `index.html` is colocated with
    // `styles/`, `libs/`, and `js/`, so relative URLs work as-is. No CSP /
    // nonce in static mode (the VS Code panel adds those in its own host
    // hooks).
    const hooks: ShellHostHooks = {
        resolveStyle: (rel) => rel,
        resolveLib: (rel) => rel,
        resolveScript: (rel) => rel,
    };

    const html = renderShell({ hooks, title: 'Project View', dataScriptUrls });

    // Write HTML
    const destHtmlPath = path.join(destinationDir, 'index.html');
    fs.writeFileSync(destHtmlPath, html, 'utf8');

    // Loop 01: record the shell hash so the next regeneration can
    // short-circuit when nothing changed.
    writeCachedShellHash(destinationDir, shellHash);

    return destHtmlPath;
}
