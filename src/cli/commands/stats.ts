/**
 * `llmem stats` — show graph statistics.
 *
 * Body lifted near-mechanically from the original CLI module's commandStats.
 * Loop 01 contract: NO behavior change.
 */

import { z } from 'zod';

import { hasEdgeLists, getGraphStats } from '../../viewer-generator';
import { detectWorkspace } from '../../workspace';
import type { CommandSpec } from '../registry';
import { CliError } from '../errors';

const statsArgs = z.object({
    workspace: z.string().optional(),
});

export const statsCommand: CommandSpec<typeof statsArgs> = {
    name: 'stats',
    // design/06 § Implementation order step 9: hidden, not deleted (still callable).
    hidden: true,
    description: 'Show graph statistics',
    examples: [
        { scenario: 'Print graph statistics for the auto-detected workspace', command: 'llmem stats' },
    ],
    args: statsArgs,
    async run(args, cli) {
        const workspace = detectWorkspace(args.workspace);

        console.log(`Workspace: ${workspace}`);

        if (!hasEdgeLists(workspace)) {
            throw new CliError('Error: No edge lists found. Please scan workspace first.', 1);
        }

        // Loop 04: getGraphStats now takes a WorkspaceContext.
        const ctx = await cli.createWorkspace(workspace);
        const stats = await getGraphStats(ctx);

        console.log('');
        console.log('Graph Statistics:');
        console.log('');
        console.log('  Import Graph:');
        console.log(`    Nodes (files): ${stats.importNodes}`);
        console.log(`    Edges: ${stats.importEdges}`);
        console.log('');
        console.log('  Call Graph:');
        console.log(`    Nodes (functions): ${stats.callNodes}`);
        console.log(`    Edges: ${stats.callEdges}`);
        console.log('');
        console.log(`  Total Files: ${stats.fileCount}`);
        console.log(`  Last Updated: ${new Date(stats.lastUpdated).toLocaleString()}`);
        console.log('');
    },
};
