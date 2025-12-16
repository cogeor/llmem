
import * as fs from 'fs-extra';
import * as path from 'path';
import * as esbuild from 'esbuild';
import { generateWorkTree } from './worktree';
import { convertAllMarkdown } from './utils/md-converter';

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
 * @returns The absolute path to the generated index.html
 */
export async function generateStaticWebview(
    destinationDir: string,
    extensionRoot: string,
    graphData: any,
    options: GeneratorOptions = {}
): Promise<string> {

    const { graphOnly = false } = options;

    // Ensure destination exists
    if (!fs.existsSync(destinationDir)) {
        fs.mkdirSync(destinationDir, { recursive: true });
    }


    const srcWebview = path.join(extensionRoot, 'src', 'webview');

    // 1. Copy Assets
    // We need styles/ and libs/vis-network.min.js

    // Copy styles folder
    const stylesSrc = path.join(srcWebview, 'styles');
    const stylesDest = path.join(destinationDir, 'styles');
    if (fs.existsSync(stylesSrc)) {
        fs.cpSync(stylesSrc, stylesDest, { recursive: true });
    } else {
        console.warn(`Warning: styles folder not found at ${stylesSrc}`);
    }

    // 2. Bundle Webview UI (TypeScript -> main.js)
    console.log('Bundling webview UI...');
    try {
        await esbuild.build({
            entryPoints: [path.join(srcWebview, 'ui', 'main.ts')],
            bundle: true,
            outfile: path.join(destinationDir, 'js', 'main.js'),
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

    // Copy libs
    const libsSrc = path.join(srcWebview, 'libs');
    const libsDest = path.join(destinationDir, 'libs');
    if (fs.existsSync(libsSrc)) {
        fs.cpSync(libsSrc, libsDest, { recursive: true });
    } else {
        console.warn(`Warning: libs folder not found at ${libsSrc}`);
    }

    // 3. Copy .arch folder to arch (skip in graph-only mode)
    const archSrc = path.join(extensionRoot, '.arch');
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
    if (!graphOnly) {
        const workTree = await generateWorkTree(extensionRoot, path.join(extensionRoot, 'src'));
        const treePath = path.join(destinationDir, 'work_tree.js');
        const treeContent = `window.WORK_TREE = ${JSON.stringify(workTree, null, 2)};`;
        fs.writeFileSync(treePath, treeContent, 'utf8');
    }

    // 5. Read and Template HTML
    const htmlPath = path.join(srcWebview, 'index.html');
    let htmlContent = fs.readFileSync(htmlPath, 'utf8');

    // Inject data
    // We inject a script tag before main.js that sets window.GRAPH_DATA_URL

    // Write graph data to JS file
    const graphDataPath = path.join(destinationDir, 'graph_data.js');
    const graphDataContent = `window.GRAPH_DATA = ${JSON.stringify(graphData, null, 2)};`;
    fs.writeFileSync(graphDataPath, graphDataContent, 'utf8');

    // 6. Bundle Design Docs (skip in graph-only mode)
    if (!graphOnly) {
        const designDocs: { [key: string]: string } = {};
        if (fs.existsSync(archDest)) {
            const readDocs = (dir: string, base: string) => {
                const files = fs.readdirSync(dir, { withFileTypes: true });
                for (const file of files) {
                    const fullPath = path.join(dir, file.name);
                    const relPath = path.posix.join(base, file.name);
                    if (file.isDirectory()) {
                        readDocs(fullPath, relPath);
                    } else if (file.isFile() && (file.name.endsWith('.txt') || file.name.endsWith('.html'))) {
                        // For now assuming .txt or .html
                        const content = fs.readFileSync(fullPath, 'utf8');
                        // Store with relative path relative to 'arch/'
                        // e.g. "src/foo.txt"
                        designDocs[relPath] = content;
                    }
                }
            };
            readDocs(archDest, '');
        }
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
