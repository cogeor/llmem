/**
 * `llmem scan` — index the workspace and write edge lists.
 *
 * Backed by `application/scan.ts:scanFolderRecursive` (NOT the deprecated
 * `src/scripts/generate_edgelist.ts`). Mirrors the zero-config scan path
 * already in `serve.ts:88-101` so the user-visible "Indexed N files
 * (M skipped, K errors)." summary stays consistent across commands.
 *
 * See design/06 § Per-command specs → commands/scan.ts.
 */

import * as path from 'path';
import * as fs from 'fs';
import { z } from 'zod';

import { scanFolderRecursive } from '../../../application/scan';
import { WorkspaceIO } from '../../../workspace/workspace-io';
import { asWorkspaceRoot } from '../../../core/paths';
import type { CommandSpec } from '../registry';

/**
 * Detect workspace root.
 *
 * Local copy of detectWorkspace lifted from serve.ts:36-61 (which itself
 * was lifted from cli.ts:108-133). Each command file gets its own copy
 * for now; deduplication is explicitly deferred.
 *
 * TODO(loop 06+): hoist to src/claude/cli/context.ts to stop duplicating
 * across commands.
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
    async run(args) {
        const workspace = detectWorkspace(args.workspace);

        console.log(`Workspace: ${workspace}`);

        const io = await WorkspaceIO.create(asWorkspaceRoot(workspace));
        const artifactDir = path.join(workspace, '.artifacts');

        console.log(`Scanning ${args.folder}...`);

        const result = await scanFolderRecursive({
            workspaceRoot: asWorkspaceRoot(workspace),
            folderPath: args.folder,
            artifactDir,
            io,
        });

        console.log(
            `Indexed ${result.filesProcessed} files ` +
            `(${result.filesSkipped} skipped, ${result.errors.length} errors).`,
        );

        // Wired by loops 08 + 10 of design/02:
        //   - buildFolderTree from src/graph/folder-tree.ts
        //   - buildFolderEdges from src/graph/folder-edges.ts
        //   - persist via FolderTreeStore / FolderEdgelistStore
        // Until those land, the scan emits import-edgelist.json + call-edgelist.json only.

        if (result.errors.length > 0) {
            process.exit(1);
        }
    },
};
