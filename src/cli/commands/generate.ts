/**
 * `llmem generate` — generate graph without starting server.
 *
 * Body lifted near-mechanically from the original CLI module's commandGenerate.
 * Loop 01 contract: NO behavior change.
 */

import { z } from 'zod';

import { hasEdgeLists, generateGraph } from '../../viewer-generator';
import { detectWorkspace } from '../../workspace';
import type { CommandSpec } from '../registry';
import { CliError } from '../errors';

const ASSET_ROOT_OVERRIDE = process.env.LLMEM_ASSET_ROOT || undefined;

const generateArgs = z.object({
    workspace: z.string().optional(),
});

export const generateCommand: CommandSpec<typeof generateArgs> = {
    name: 'generate',
    // design/06 § Implementation order step 9: hidden, not deleted (still callable).
    hidden: true,
    description: 'Generate graph without starting server',
    examples: [
        { scenario: 'Regenerate the static webview from existing edge lists', command: 'llmem generate' },
        { scenario: 'Regenerate against a specific workspace', command: 'llmem generate --workspace /path/to/repo' },
    ],
    args: generateArgs,
    async run(args) {
        const workspace = detectWorkspace(args.workspace);

        console.log(`Workspace: ${workspace}`);

        if (!hasEdgeLists(workspace)) {
            throw new CliError('Error: No edge lists found. Please scan workspace first.', 1);
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
