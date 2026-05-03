/**
 * `llmem generate` — generate graph without starting server.
 *
 * Body lifted near-mechanically from src/claude/cli.ts:commandGenerate.
 * Loop 01 contract: NO behavior change.
 */

import * as path from 'path';
import * as fs from 'fs';
import { z } from 'zod';

import { hasEdgeLists, generateGraph } from '../../web-launcher';
import type { CommandSpec } from '../registry';

const ASSET_ROOT_OVERRIDE = process.env.LLMEM_ASSET_ROOT || undefined;

/**
 * Detect workspace root.
 * Local copy from cli.ts:108-133. Loop 03+ may centralize.
 */
function detectWorkspace(explicit?: string): string {
    if (explicit) {
        if (!fs.existsSync(explicit)) {
            console.error(`Error: Workspace not found: ${explicit}`);
            process.exit(1);
        }
        return path.resolve(explicit);
    }

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

    return process.cwd();
}

const generateArgs = z.object({
    workspace: z.string().optional(),
});

export const generateCommand: CommandSpec<typeof generateArgs> = {
    name: 'generate',
    description: 'Generate graph without starting server',
    args: generateArgs,
    async run(args) {
        const workspace = detectWorkspace(args.workspace);

        console.log(`Workspace: ${workspace}`);

        if (!hasEdgeLists(workspace)) {
            console.error('Error: No edge lists found. Please scan workspace first.');
            process.exit(1);
        }

        console.log('Generating graph...');
        const result = await generateGraph({
            workspaceRoot: workspace,
            graphOnly: false,  // Generate full 3-panel UI by default
            assetRoot: ASSET_ROOT_OVERRIDE,
        });

        console.log('');
        console.log('✓ Graph generated successfully');
        console.log('');
        console.log(`  Files: ${result.importNodeCount}`);
        console.log(`  Imports: ${result.importEdgeCount}`);
        console.log(`  Functions: ${result.callNodeCount}`);
        console.log(`  Calls: ${result.callEdgeCount}`);
        console.log('');
        console.log(`  Output: ${result.indexPath}`);
        console.log(`  URL: ${result.url}`);
        console.log('');
    },
};
