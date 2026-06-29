/**
 * `llmem serve` — start HTTP webview server.
 *
 * Body lifted near-mechanically from the original CLI module's commandServe.
 *  - port defaults to DEFAULT_PORT (config-defaults.ts), walks up +9 on EADDRINUSE (loop 02).
 *  - `--open` defaults to true; pass `--no-open` for headless/CI (loop 03).
 *  - zero-config: when no edge lists exist, scans the workspace via
 *    `application/scan.ts:scanFolderRecursive` and continues. Never
 *    hard-fails on a missing index (loop 03).
 *
 * Loop 04: replaces the per-command `WorkspaceIO.create` with a single
 * `cli.createWorkspace(workspace)` call. The same context is threaded
 * through `scanFolderRecursive`. `GraphServer` keeps its current
 * `ServerConfig` constructor — it constructs its own context internally,
 * letting non-CLI hosts keep using the loose `ServerConfig` shape.
 */

import * as path from 'path';
import * as fs from 'fs';
import { z } from 'zod';

import { GraphServer } from '../../http-server';
import { hasEdgeLists, generateGraph } from '../../viewer-generator';
import { scanFolderRecursive, formatUnsupportedSourceHints } from '../../application/scan';
import { detectWorkspace } from '../../workspace';
import { DEFAULT_PORT, DEFAULT_CONFIG } from '../../config-defaults';
import type { CommandSpec } from '../registry';

// Loop 21 — optional explicit override for the webview asset directory.
// When set, the launcher uses this path verbatim; otherwise it falls back
// to its discovery chain (workspaceRoot/dist/webview → repo-root walk-up
// → src/webview). Empty string is treated the same as unset.
const ASSET_ROOT_OVERRIDE = process.env.LLMEM_ASSET_ROOT || undefined;

const serveArgs = z.object({
    port: z.number().int().min(0).max(65535).default(DEFAULT_PORT),
    workspace: z.string().optional(),
    regenerate: z.boolean().default(false),
    open: z.boolean().default(true),      // Loop 03: default-on per design/06.
    verbose: z.boolean().default(false),
});

export const serveCommand: CommandSpec<typeof serveArgs> = {
    name: 'serve',
    description: 'Start HTTP server for webview (default)',
    examples: [
        { scenario: 'Open the viewer in your browser', command: 'llmem serve' },
        { scenario: 'Use a custom port without opening a browser', command: 'llmem serve --port 8080 --no-open' },
        { scenario: 'Force re-scan and regenerate before serving', command: 'llmem serve --regenerate' },
    ],
    args: serveArgs,
    async run(args, cli) {
        const workspace = detectWorkspace(args.workspace);

        console.log(`Workspace: ${workspace}`);

        // Resolve the workspace context ONCE (honors LLMEM_ARTIFACT_ROOT /
        // vscode / default — do NOT hardcode a fallback root) so the probe,
        // cold scan, webview dir, and generateGraph all agree on a single
        // artifactRoot (the centralized `.llmem/graph` default).
        const ctx = await cli.createWorkspace(workspace);
        const artifactRoot = ctx.config.artifactRoot;

        // Loop 03: zero-config. If no edge lists exist, run the canonical
        // application-layer scan over the workspace root. We never abort the
        // user's `serve` invocation for a missing index — they get one for free.
        if (!hasEdgeLists(workspace, artifactRoot)) {
            console.log('Indexing workspace... (first run)');
            const result = await scanFolderRecursive(ctx, { folderPath: '.' });
            console.log(
                `Indexed ${result.filesProcessed} files ` +
                `(${result.filesSkipped} skipped, ${result.errors.length} errors).`,
            );
            // Loop-03 / code-polish: surface skipped-language counts so
            // users know which peer grammars to install. Zero lines when
            // no allowlist files were silently dropped. Placed BEFORE
            // the existing zero-files message so the two complement
            // each other — this one covers "found some, missed others",
            // the next one covers "found nothing".
            for (const line of formatUnsupportedSourceHints(result.unsupportedSourceLikeCounts)) {
                console.log(line);
            }
            if (result.filesProcessed === 0) {
                console.log(
                    'No supported source files found. LLMem ships with TypeScript/JavaScript ' +
                    'support out of the box; install peer grammars (tree-sitter-python, ' +
                    'tree-sitter-rust, tree-sitter-cpp, @davisvaughan/tree-sitter-r) for ' +
                    'additional languages. Starting server anyway with an empty graph.',
                );
            }
        }

        // Regenerate if requested or if webview doesn't exist
        const webviewDir = path.join(workspace, artifactRoot, 'webview');
        const shouldRegenerate = args.regenerate || !fs.existsSync(webviewDir);

        if (shouldRegenerate) {
            console.log('Generating graph...');
            const result = await generateGraph({
                workspaceRoot: workspace,
                graphOnly: false,  // Generate full 3-panel UI by default
                assetRoot: ASSET_ROOT_OVERRIDE,
            });
            console.log(
                `✓ Displayed graph (watched subset): ${result.importNodeCount} files, ` +
                `${result.importEdgeCount} imports`,
            );
            if (result.importNodeCount === 0) {
                console.log(
                    '  Toggle files in the explorer (left pane) to add them to the graph.',
                );
            }
            console.log('');
        }

        // Start server. `GraphServer` constructs its own internal
        // `WorkspaceContext` from `ServerConfig` so non-CLI hosts (HTTP-
        // only embedders) can continue to drive it without the CLI
        // factory.
        const server = new GraphServer({
            workspaceRoot: workspace,
            port: args.port,
            openBrowser: args.open,
            verbose: args.verbose,
        });

        await server.start();

        // Handle Ctrl+C gracefully. This is the one legitimate `process.exit`
        // in a command module (A-grade #2): a SIGINT handler must terminate the
        // long-running server process itself — there is no `run()` caller left
        // to return an exit status to.
        process.on('SIGINT', async () => {
            console.log('');
            console.log('Stopping server...');
            await server.stop();
            process.exit(0);
        });
    },
};
