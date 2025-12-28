
import * as fs from 'fs-extra';
import * as path from 'path';
// NOTE: esbuild is lazy-loaded to avoid errors when not installed (e.g., in bundled MCP server)
import { generateWorkTree } from './worktree';
import { convertAllMarkdown } from './utils/md-converter';
import { loadDesignDocs } from './design-docs';

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
    watchedFiles?: string[]
): Promise<string> {

    const { graphOnly = false } = options;

    // Ensure destination exists
    if (!fs.existsSync(destinationDir)) {
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
        console.warn(`Warning: styles folder not found at ${stylesSrc}`);
    }

    // 2. Bundle or copy Webview UI
    console.log('Bundling webview UI...');
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
            console.warn(`Warning: pre-bundled main.js not found at ${bundledJs}`);
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
            console.error("Esbuild failed:", e);
            throw e;
        }
    }

    // Copy libs
    const libsSrc = path.join(webviewRoot, 'libs');
    const libsDest = path.join(destinationDir, 'libs');
    if (fs.existsSync(libsSrc)) {
        fs.cpSync(libsSrc, libsDest, { recursive: true });
    } else {
        console.warn(`Warning: libs folder not found at ${libsSrc}`);
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
            console.warn(`Warning: .arch folder not found at ${archSrc}`);
        }
    }

    // 4. Generate Folder Tree (skip in graph-only mode)
    // Use workspace root for the tree - don't assume 'src/' exists
    if (!graphOnly) {
        const workTree = await generateWorkTree(workspaceRoot, workspaceRoot);
        const treePath = path.join(destinationDir, 'work_tree.js');
        const treeContent = `window.WORK_TREE = ${JSON.stringify(workTree, null, 2)};`;
        fs.writeFileSync(treePath, treeContent, 'utf8');
    }

    // 5. Read and Template HTML
    const htmlPath = path.join(webviewRoot, 'index.html');
    let htmlContent = fs.readFileSync(htmlPath, 'utf8');

    // Inject data
    // We inject a script tag before main.js that sets window.GRAPH_DATA_URL

    // Write graph data to JS file
    const graphDataPath = path.join(destinationDir, 'graph_data.js');
    let graphDataContent = `window.GRAPH_DATA = ${JSON.stringify(graphData, null, 2)};`;

    // Add watched files if provided
    if (watchedFiles && watchedFiles.length > 0) {
        graphDataContent += `\nwindow.WATCHED_FILES = ${JSON.stringify(watchedFiles, null, 2)};`;
    }

    fs.writeFileSync(graphDataPath, graphDataContent, 'utf8');

    // 6. Bundle Design Docs (skip in graph-only mode)
    if (!graphOnly) {
        const designDocs = await loadDesignDocs(workspaceRoot);
        const designDocsPath = path.join(destinationDir, 'design_docs.js');
        const designDocsContent = `window.DESIGN_DOCS = ${JSON.stringify(designDocs, null, 2)};`;
        fs.writeFileSync(designDocsPath, designDocsContent, 'utf8');
    }

    // Build injection script based on what was generated
    const injectionScript = graphOnly
        ? `<script src="graph_data.js"></script>`
        : `
    <script src="graph_data.js"></script>
    <script src="work_tree.js"></script>
    <script src="design_docs.js"></script>
    `;

    // Insert before <script type="module" src="js/main.js">
    // We just inject the data scripts before the main module script
    // AND remove type="module" because we are using IIFE for file:// compatibility
    htmlContent = htmlContent.replace(
        '<script type="module" src="js/main.js"></script>',
        `${injectionScript}\n    <script src="js/main.js"></script>`
    );

    // Write HTML
    const destHtmlPath = path.join(destinationDir, 'index.html');
    fs.writeFileSync(destHtmlPath, htmlContent, 'utf8');

    return destHtmlPath;
}
