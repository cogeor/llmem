
import * as esbuild from 'esbuild';
import * as path from 'path';
import * as fs from 'fs-extra';

/**
 * Build script for the webview UI bundle.
 * 
 * Bundles src/webview/ui/main.ts -> dist/webview/main.js
 * 
 * The panel.ts in the extension will load this bundle and inject the styles
 * from src/webview/styles/ at runtime using webview.asWebviewUri().
 */
async function build() {
    const root = process.cwd();
    const src = path.join(root, 'src', 'webview', 'ui', 'main.ts');
    const outfile = path.join(root, 'dist', 'webview', 'main.js');

    console.log(`Building Webview UI: ${src} -> ${outfile}`);

    // Ensure output directory exists
    fs.ensureDirSync(path.dirname(outfile));

    try {
        await esbuild.build({
            entryPoints: [src],
            bundle: true,
            outfile: outfile,
            platform: 'browser',
            target: 'es2020',
            sourcemap: true,
            minify: false,
            format: 'iife',  // Immediately-invoked for browser without module system
        });
        console.log('Webview UI bundled to dist/webview/main.js');
    } catch (e) {
        console.error('Build failed:', e);
        process.exit(1);
    }
}

build();
