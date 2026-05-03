/**
 * `llmem serve` — start HTTP webview server.
 *
 * Body lifted near-mechanically from src/claude/cli.ts:commandServe.
 *  - port defaults to 3000, walks up to 3009 on EADDRINUSE (loop 02).
 *  - `--open` defaults to true; pass `--no-open` for headless/CI (loop 03).
 *  - zero-config: when no edge lists exist, scans the workspace via
 *    `application/scan.ts:scanFolderRecursive` and continues. Never
 *    hard-fails on a missing index (loop 03).
 */

import * as path from 'path';
import * as fs from 'fs';
import { z } from 'zod';

import { GraphServer } from '../../server';
import { hasEdgeLists, generateGraph } from '../../web-launcher';
import { scanFolderRecursive } from '../../../application/scan';
import { WorkspaceIO } from '../../../workspace/workspace-io';
import { asWorkspaceRoot } from '../../../core/paths';
import { detectWorkspace } from '../workspace';
import type { CommandSpec } from '../registry';

// Loop 21 — optional explicit override for the webview asset directory.
// When set, the launcher uses this path verbatim; otherwise it falls back
// to its discovery chain (workspaceRoot/dist/webview → repo-root walk-up
// → src/webview). Empty string is treated the same as unset.
const ASSET_ROOT_OVERRIDE = process.env.LLMEM_ASSET_ROOT || undefined;

const serveArgs = z.object({
    port: z.number().int().min(0).max(65535).default(3000),
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
        { scenario: 'Use port 8080 without opening a browser', command: 'llmem serve --port 8080 --no-open' },
        { scenario: 'Force re-scan and regenerate before serving', command: 'llmem serve --regenerate' },
    ],
    args: serveArgs,
    async run(args) {
        const workspace = detectWorkspace(args.workspace);

        console.log(`Workspace: ${workspace}`);

        // Loop 03: zero-config. If no edge lists exist, run the canonical
        // application-layer scan over the workspace root. We never abort the
        // user's `serve` invocation for a missing index — they get one for free.
        if (!hasEdgeLists(workspace)) {
            console.log('Indexing workspace... (first run)');
            const io = await WorkspaceIO.create(asWorkspaceRoot(workspace));
            const artifactDir = path.join(workspace, '.artifacts');
            const result = await scanFolderRecursive({
                workspaceRoot: asWorkspaceRoot(workspace),
                folderPath: '.',
                artifactDir,
                io,
            });
            console.log(
                `Indexed ${result.filesProcessed} files ` +
                `(${result.filesSkipped} skipped, ${result.errors.length} errors).`,
            );
        }

        // Regenerate if requested or if webview doesn't exist
        const webviewDir = path.join(workspace, '.artifacts', 'webview');
        const shouldRegenerate = args.regenerate || !fs.existsSync(webviewDir);

        if (shouldRegenerate) {
            console.log('Generating graph...');
            const result = await generateGraph({
                workspaceRoot: workspace,
                graphOnly: false,  // Generate full 3-panel UI by default
                assetRoot: ASSET_ROOT_OVERRIDE,
            });
            console.log(`✓ Graph generated: ${result.importNodeCount} files, ${result.importEdgeCount} imports`);
            console.log('');
        }

        // Start server
        const server = new GraphServer({
            workspaceRoot: workspace,
            port: args.port,
            openBrowser: args.open,
            verbose: args.verbose,
        });

        await server.start();

        // Handle Ctrl+C gracefully
        process.on('SIGINT', async () => {
            console.log('');
            console.log('Stopping server...');
            await server.stop();
            process.exit(0);
        });
    },
};
