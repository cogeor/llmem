import * as esbuild from 'esbuild';
import * as path from 'path';
import * as fs from 'fs-extra';

/**
 * Build script for the Claude CLI bundle.
 *
 * Bundles src/claude/cli/main.ts -> dist/claude/cli/main.js (CJS, Node).
 * Also bundles src/claude/index.ts -> dist/claude/index.js for the
 * package's `exports` entry.
 *
 * tsconfig.claude.json's narrow rootDir cannot emit cross-tree imports
 * (the CLI uses src/application, src/parser, src/graph, etc.), so we
 * use esbuild to walk the import graph and produce a single bundle per
 * entry point. Native deps (tree-sitter parsers, chokidar) and runtime
 * deps that load .node files are marked external and resolved at
 * runtime against the installed node_modules.
 *
 * Type-checking is intentionally separate (`compile:vscode` covers
 * everything outside src/claude/** + src/webview/ui/** ; src/claude/**
 * gets compiled by tsc through tsconfig.vscode.json's broad rootDir
 * coverage of upstream code, so most type errors surface there).
 */
async function build() {
    const root = process.cwd();
    const distClaude = path.join(root, 'dist', 'claude');

    fs.ensureDirSync(distClaude);
    fs.ensureDirSync(path.join(distClaude, 'cli'));

    // Mark all dependencies + peerDependencies as external. esbuild bundles
    // first-party TypeScript only; npm deps are resolved at runtime.
    const pkg = fs.readJsonSync(path.join(root, 'package.json')) as {
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
    };
    const external = [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
        // Node built-ins are external by default in platform: 'node', but
        // the `vscode` ambient module is referenced behind type-only imports
        // and must never be bundled.
        'vscode',
    ];

    const targets: Array<{ entry: string; out: string }> = [
        {
            entry: path.join(root, 'src', 'claude', 'cli', 'main.ts'),
            out: path.join(distClaude, 'cli', 'main.js'),
        },
        {
            entry: path.join(root, 'src', 'claude', 'index.ts'),
            out: path.join(distClaude, 'index.js'),
        },
    ];

    for (const { entry, out } of targets) {
        console.log(`Building Claude bundle: ${entry} -> ${out}`);
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

    console.log('Claude build complete - dist/claude/cli/main.js + dist/claude/index.js');
}

build().catch((err) => {
    console.error('Build failed:', err);
    process.exit(1);
});
