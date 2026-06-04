import * as esbuild from 'esbuild';
import * as path from 'path';
import * as fs from 'fs-extra';

/**
 * Build script for the standalone entry-point bundles.
 *
 * Bundles src/cli/main.ts -> dist/cli/main.js (CJS, Node) for the
 * `bin/llmem` CLI shim, and src/mcp/entry.ts -> dist/mcp/main.js (CJS,
 * Node) for the package's `exports` / `main` entry (the MCP stdio
 * server).
 *
 * A narrow per-entry tsconfig rootDir cannot emit cross-tree imports
 * (the CLI and MCP entry use src/application, src/parser, src/graph,
 * etc.), so we use esbuild to walk the import graph and produce a single
 * bundle per entry point. Native deps (tree-sitter parsers, chokidar)
 * and runtime deps that load .node files are marked external and
 * resolved at runtime against the installed node_modules.
 *
 * Type-checking is intentionally separate (`compile:vscode` covers the
 * whole src/ tree except src/webview/ui/**, so type errors — including
 * for src/cli/** and src/mcp/** — surface there).
 */
async function build() {
    const root = process.cwd();
    const distCli = path.join(root, 'dist', 'cli');
    const distMcp = path.join(root, 'dist', 'mcp');

    fs.ensureDirSync(distCli);
    fs.ensureDirSync(distMcp);

    // Mark all dependencies + peerDependencies as external. esbuild bundles
    // first-party TypeScript only; npm deps are resolved at runtime.
    const pkg = fs.readJsonSync(path.join(root, 'package.json')) as {
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
    };
    const external = [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.optionalDependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
        // Node built-ins are external by default in platform: 'node', but
        // the `vscode` ambient module is referenced behind type-only imports
        // and must never be bundled.
        'vscode',
    ];

    const targets: Array<{ entry: string; out: string }> = [
        {
            entry: path.join(root, 'src', 'cli', 'main.ts'),
            out: path.join(distCli, 'main.js'),
        },
        {
            entry: path.join(root, 'src', 'mcp', 'entry.ts'),
            out: path.join(distMcp, 'main.js'),
        },
    ];

    for (const { entry, out } of targets) {
        console.log(`Building entry-point bundle: ${entry} -> ${out}`);
        await esbuild.build({
            entryPoints: [entry],
            bundle: true,
            outfile: out,
            platform: 'node',
            target: 'node20',
            format: 'cjs',
            sourcemap: true,
            minify: false,
            external,
            logLevel: 'warning',
        });
    }

    console.log('Entry-point build complete - dist/cli/main.js + dist/mcp/main.js');
}

build().catch((err) => {
    console.error('Build failed:', err);
    process.exit(1);
});
