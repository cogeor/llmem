/**
 * `llmem serve` — start HTTP webview server.
 *
 * Body lifted near-mechanically from src/claude/cli.ts:commandServe.
 * Loop 01 contract: NO behavior change.
 *  - port defaults to 3000, hard-fail if occupied (port-fallback is loop 02).
 *  - `--open` defaults to false (opt-in; flips to default-on in loop 03).
 *  - hard-fails when no edge lists exist (auto-scan is loop 03).
 */

import * as path from 'path';
import * as fs from 'fs';
import { z } from 'zod';

import { GraphServer } from '../../server';
import { hasEdgeLists, generateGraph } from '../../web-launcher';
import type { CommandSpec } from '../registry';

// Loop 21 — optional explicit override for the webview asset directory.
// When set, the launcher uses this path verbatim; otherwise it falls back
// to its discovery chain (workspaceRoot/dist/webview → repo-root walk-up
// → src/webview). Empty string is treated the same as unset.
const ASSET_ROOT_OVERRIDE = process.env.LLMEM_ASSET_ROOT || undefined;

/**
 * Detect workspace root.
 *
 * Local copy of detectWorkspace lifted from cli.ts:108-133. Each command
 * file gets its own copy in loop 01; deduplication can wait until loop 03+
 * when serve and scan share more.
 */
function detectWorkspace(explicit?: string): string {
    if (explicit) {
        if (!fs.existsSync(explicit)) {
            console.error(`Error: Workspace not found: ${explicit}`);
            process.exit(1);
        }
        return path.resolve(explicit);
    }

    // Auto-detect
    const markers = ['.git', 'package.json', '.llmem', '.arch', '.artifacts'];
    let current = process.cwd();
    const root = path.parse(current).root;

    while (current !== root) {
        for (const marker of markers) {
            if (fs.existsSync(path.join(current, marker))) {
                return current;
            }
        }
        current = path.dirname(current);
    }

    // Fallback to cwd
    return process.cwd();
}

const serveArgs = z.object({
    port: z.number().int().min(0).max(65535).default(3000),
    workspace: z.string().optional(),
    regenerate: z.boolean().default(false),
    open: z.boolean().default(false),     // OPT-IN — loop 03 flips to default(true)
    verbose: z.boolean().default(false),
});

export const serveCommand: CommandSpec<typeof serveArgs> = {
    name: 'serve',
    description: 'Start HTTP server for webview (default)',
    args: serveArgs,
    async run(args) {
        const workspace = detectWorkspace(args.workspace);

        console.log(`Workspace: ${workspace}`);

        // Check if edge lists exist
        if (!hasEdgeLists(workspace)) {
            console.error('');
            console.error('Error: No edge lists found in workspace.');
            console.error('');
            console.error('Please scan your workspace first:');
            console.error('  1. Use the VSCode extension to toggle files/folders');
            console.error('  2. Or ask Claude to analyze your codebase');
            console.error('');
            process.exit(1);
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
