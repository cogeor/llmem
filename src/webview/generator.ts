import * as fs from 'fs';
import * as path from 'path';

/**
 * Generate a static webview folder in the artifacts directory.
 * 
 * @param destinationDir - The directory where the static webview should be generated (e.g., .artifacts/webview)
 * @param extensionRoot - The root of the extension (to find source src/webview files)
 * @param graphData - The graph data object to inject
 * @returns The absolute path to the generated index.html
 */
export async function generateStaticWebview(
    destinationDir: string,
    extensionRoot: string,
    graphData: any
): Promise<string> {

    // Ensure destination exists
    if (!fs.existsSync(destinationDir)) {
        fs.mkdirSync(destinationDir, { recursive: true });
    }

    const srcWebview = path.join(extensionRoot, 'src', 'webview');

    // 1. Copy Assets
    // We need style.css, main.js, and libs/vis-network.min.js
    const filesToCopy = [
        { src: 'style.css', dest: 'style.css' },
        { src: 'main.js', dest: 'main.js' },
        { src: 'libs/vis-network.min.js', dest: 'libs/vis-network.min.js' }
    ];

    // Ensure libs dir exists
    const libsDir = path.join(destinationDir, 'libs');
    if (!fs.existsSync(libsDir)) {
        fs.mkdirSync(libsDir, { recursive: true });
    }

    for (const file of filesToCopy) {
        const srcPath = path.join(srcWebview, file.src);
        const destPath = path.join(destinationDir, file.dest);

        // Check if src exists (it should in the installed extension or src tree)
        if (fs.existsSync(srcPath)) {
            fs.copyFileSync(srcPath, destPath);
        } else {
            console.warn(`Warning: Asset not found: ${srcPath}`);
        }
    }

    // 2. Read and Template HTML
    const htmlPath = path.join(srcWebview, 'index.html');
    let htmlContent = fs.readFileSync(htmlPath, 'utf8');

    // Inject data
    // We inject a script tag before main.js that sets window.INITIAL_DATA
    const injectionScript = `
    <script>
        window.INITIAL_DATA = ${JSON.stringify(graphData)};
    </script>
    `;

    // Insert before <script src="main.js">
    htmlContent = htmlContent.replace('<script src="main.js"></script>', `${injectionScript}\n    <script src="main.js"></script>`);

    // Write HTML
    const destHtmlPath = path.join(destinationDir, 'index.html');
    fs.writeFileSync(destHtmlPath, htmlContent, 'utf8');

    return destHtmlPath;
}
