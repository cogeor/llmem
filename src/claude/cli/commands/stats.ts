/**
 * `llmem stats` — show graph statistics.
 *
 * Body lifted near-mechanically from src/claude/cli.ts:commandStats.
 * Loop 01 contract: NO behavior change.
 */

import * as path from 'path';
import * as fs from 'fs';
import { z } from 'zod';

import { hasEdgeLists, getGraphStats } from '../../web-launcher';
import type { CommandSpec } from '../registry';

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

const statsArgs = z.object({
    workspace: z.string().optional(),
});

export const statsCommand: CommandSpec<typeof statsArgs> = {
    name: 'stats',
    description: 'Show graph statistics',
    examples: [
        { scenario: 'Print graph statistics for the auto-detected workspace', command: 'llmem stats' },
    ],
    args: statsArgs,
    async run(args) {
        const workspace = detectWorkspace(args.workspace);

        console.log(`Workspace: ${workspace}`);

        if (!hasEdgeLists(workspace)) {
            console.error('Error: No edge lists found. Please scan workspace first.');
            process.exit(1);
        }

        const stats = await getGraphStats(workspace);

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
