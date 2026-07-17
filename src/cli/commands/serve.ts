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
import { generateGraph } from '../../viewer-generator';
import { detectWorkspace } from '../../workspace';
import { DEFAULT_PORT } from '../../config-defaults';
import type { CommandSpec } from '../registry';
import { ensureGraph } from './ensure-graph';

// Loop 21 — optional explicit override for the webview asset directory.
// When set, the launcher uses this path verbatim; otherwise it falls back
// to its discovery chain (workspaceRoot/dist/webview → repo-root walk-up
// → src/webview). Empty string is treated the same as unset.
const ASSET_ROOT_OVERRIDE = process.env.LLMEM_ASSET_ROOT || undefined;

const serveArgs = z.object({
    port: z.number().int().min(0).max(65535).default(DEFAULT_PORT),
    workspace: z.string().optional(),
    regenerate: z.boolean().default(false),
    artifactRoot: z.string().optional().describe('Artifact store directory (absolute paths allowed, may be outside the workspace; overrides LLMEM_ARTIFACT_ROOT; default: .llmem/graph)'),
    open: z.boolean().default(true),      // Loop 03: default-on per design/06.
    verbose: z.boolean().default(false),
}).strict();

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
        const ctx = await cli.createWorkspace(workspace, { artifactRoot: args.artifactRoot });
        const artifactRoot = ctx.config.artifactRoot;

        // Loop 03: zero-config. If no edge lists exist, run the canonical
        // application-layer scan over the workspace root (shared `ensureGraph`
        // since A5). We never abort the user's `serve` invocation for a
        // missing index — they get one for free.
        const ensured = await ensureGraph(ctx);
        if (ensured.scanned && ensured.filesProcessed === 0) {
            console.log(
                'No supported source files found. LLMem ships with TypeScript/JavaScript ' +
                'support out of the box; install peer grammars (tree-sitter-python, ' +
                'tree-sitter-rust, tree-sitter-cpp, @davisvaughan/tree-sitter-r) for ' +
                'additional languages. Starting server anyway with an empty graph.',
            );
        }

        // Regenerate if requested or if webview doesn't exist. Use the
        // RESOLVED absolute artifact root (may live outside the workspace).
        const webviewDir = path.join(ctx.artifactRoot, 'webview');
        const shouldRegenerate = args.regenerate || !fs.existsSync(webviewDir);

        if (shouldRegenerate) {
            console.log('Generating graph...');
            // Reuse the CLI context so the generator honors the SAME
            // resolved artifact root as the probe / cold scan above.
            const result = await generateGraph({
                ctx,
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
            artifactRoot,
            port: args.port,
            openBrowser: args.open,
            verbose: args.verbose,
        });

        await server.start();

        // B3: the one line a first-time user needs, on stdout (the
        // structured "Server running" announcement goes to stderr and is
        // easy to miss). getPort() reports the ACTUAL bound port after the
        // EADDRINUSE walk-up, so the printed URL always works.
        console.log(`➜ Open http://localhost:${server.getPort()}`);

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
