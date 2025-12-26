import * as esbuild from 'esbuild';
import * as path from 'path';
import * as fs from 'fs-extra';

/**
 * Build script for the webview UI bundle.
 *
 * Bundles src/webview/ui/main.ts -> dist/webview/main.js
 * Also copies webview assets (HTML, styles, libs) to dist/webview for portable CLI.
 *
 * The panel.ts in the extension will load this bundle and inject the styles
 * from src/webview/styles/ at runtime using webview.asWebviewUri().
 */
async function build() {
    const root = process.cwd();
    const srcWebview = path.join(root, 'src', 'webview');
    const distWebview = path.join(root, 'dist', 'webview');
    const src = path.join(srcWebview, 'ui', 'main.ts');
    const outfile = path.join(distWebview, 'main.js');

    console.log(`Building Webview UI: ${src} -> ${outfile}`);

    // Ensure output directory exists
    fs.ensureDirSync(distWebview);

    try {
        // 1. Bundle the TypeScript UI
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

        // 2. Copy static assets for portable CLI
        // These are needed by web-launcher.ts when running outside the source tree

        // Copy index.html
        const indexSrc = path.join(srcWebview, 'index.html');
        const indexDest = path.join(distWebview, 'index.html');
        fs.copySync(indexSrc, indexDest);
        console.log('Copied index.html to dist/webview/');

        // Copy styles directory
        const stylesSrc = path.join(srcWebview, 'styles');
        const stylesDest = path.join(distWebview, 'styles');
        if (fs.existsSync(stylesSrc)) {
            fs.copySync(stylesSrc, stylesDest);
            console.log('Copied styles/ to dist/webview/');
        }

        // Copy libs directory
        const libsSrc = path.join(srcWebview, 'libs');
        const libsDest = path.join(distWebview, 'libs');
        if (fs.existsSync(libsSrc)) {
            fs.copySync(libsSrc, libsDest);
            console.log('Copied libs/ to dist/webview/');
        }

        console.log('Webview build complete - ready for portable CLI usage');
    } catch (e) {
        console.error('Build failed:', e);
        process.exit(1);
    }
}

build();
