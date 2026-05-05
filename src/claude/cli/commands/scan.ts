/**
 * `llmem scan` — index the workspace and write edge lists.
 *
 * Backed by `application/scan.ts:scanFolderRecursive` (NOT the deprecated
 * `src/scripts/generate_edgelist.ts`). Mirrors the zero-config scan path
 * already in `serve.ts:88-101` so the user-visible "Indexed N files
 * (M skipped, K errors)." summary stays consistent across commands.
 *
 * See design/06 § Per-command specs → commands/scan.ts.
 *
 * Loop 04: builds a single `WorkspaceContext` via `cli.createWorkspace`
 * and threads it through `scanFolderRecursive` and
 * `buildAndSaveFolderArtifacts`.
 */

import { z } from 'zod';

import { scanFolderRecursive } from '../../../application/scan';
import { buildAndSaveFolderArtifacts } from '../../../application/folder-artifacts';
import { detectWorkspace } from '../workspace';
import type { CommandSpec } from '../registry';

const scanArgs = z.object({
    workspace: z.string().optional().describe('Workspace root directory (auto-detected if omitted)'),
    folder: z.string().default('.').describe('Workspace-relative folder to scan (defaults to the whole workspace)'),
});

export const scanCommand: CommandSpec<typeof scanArgs> = {
    name: 'scan',
    description: 'Scan the workspace and write edge lists to .artifacts/',
    examples: [
        { scenario: 'Index the entire workspace', command: 'llmem scan' },
        { scenario: 'Index a single folder', command: 'llmem scan --folder src/parser' },
    ],
    args: scanArgs,
    async run(args, cli) {
        const workspace = detectWorkspace(args.workspace);

        console.log(`Workspace: ${workspace}`);

        const ctx = await cli.createWorkspace(workspace);

        console.log(`Scanning ${args.folder}...`);

        const result = await scanFolderRecursive(ctx, { folderPath: args.folder });

        console.log(
            `Indexed ${result.filesProcessed} files ` +
            `(${result.filesSkipped} skipped, ${result.errors.length} errors).`,
        );

        // Loop 10 — emit folder-tree.json + folder-edgelist.json next to
        // the edge lists. Closes the loop-05 stub. Order matters: this
        // runs AFTER scanFolderRecursive (so the edge lists are on disk)
        // and BEFORE the parse-error exit gate (so partial-success scans
        // still produce folder artifacts).
        await buildAndSaveFolderArtifacts(ctx);

        if (result.errors.length > 0) {
            process.exit(1);
        }
    },
};
