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

import { scanFolderRecursive, formatUnsupportedSourceHints } from '../../application/scan';
import { buildAndSaveFolderArtifacts } from '../../application/folder-artifacts';
import { detectWorkspace } from '../../workspace';
import type { CommandSpec } from '../registry';
import { CliError } from '../errors';
import { createScanProgress } from '../progress';

const scanArgs = z.object({
    workspace: z.string().optional().describe('Workspace root directory (auto-detected if omitted)'),
    folder: z.string().default('.').describe('Workspace-relative folder to scan (defaults to the whole workspace)'),
    external: z.boolean().default(false).describe('Include external-module import edges (default: internal-only)'),
    artifactRoot: z.string().optional().describe('Artifact store directory (absolute paths allowed, may be outside the workspace; overrides LLMEM_ARTIFACT_ROOT; default: .llmem/graph)'),
    verbose: z.boolean().default(false).describe('Show per-file scan diagnostics'),
}).strict();

export const scanCommand: CommandSpec<typeof scanArgs> = {
    name: 'scan',
    description: 'Scan the workspace and write edge lists to .llmem/graph/',
    examples: [
        { scenario: 'Index the entire workspace', command: 'llmem scan' },
        { scenario: 'Index a single folder', command: 'llmem scan --folder src/parser' },
    ],
    args: scanArgs,
    async run(args, cli) {
        const workspace = detectWorkspace(args.workspace);

        console.log(`Workspace: ${workspace}`);

        // Internal-only is the default; `--external` opts back into emitting
        // external-module import edges/nodes. The CLI's createWorkspace loose
        // path seeds config from DEFAULT_CONFIG (internalOnly=true), so the
        // override here is what flips it: effective internalOnly = default &&
        // !args.external. Threaded onto ctx.config so it reaches RunParserInput
        // via scanFolder → runParser.
        const ctx = await cli.createWorkspace(workspace, {
            internalOnly: !args.external,
            artifactRoot: args.artifactRoot,
        });

        console.log(`Scanning ${args.folder}...`);

        // B3: live progress — an overwriting status line on a TTY, dots in
        // CI/piped output. Suppressed under --verbose (the per-file debug
        // diagnostics already narrate progress there).
        const progress = createScanProgress();
        const result = await scanFolderRecursive(ctx, {
            folderPath: args.folder,
            onFile: args.verbose ? undefined : progress.onFile,
        });
        progress.finish();

        console.log(
            `Indexed ${result.filesProcessed} files ` +
            `(${result.filesSkipped} skipped, ${result.errors.length} errors).`,
        );

        // Loop-03 / code-polish: surface skipped-language counts so users
        // know which peer grammars to install. Zero lines when no
        // allowlist files were silently dropped.
        for (const line of formatUnsupportedSourceHints(result.unsupportedSourceLikeCounts)) {
            console.log(line);
        }

        // Loop 10 — emit folder-tree.json + folder-edgelist.json next to
        // the edge lists. Closes the loop-05 stub. Order matters: this
        // runs AFTER scanFolderRecursive (so the edge lists are on disk)
        // and BEFORE the parse-error exit gate (so partial-success scans
        // still produce folder artifacts).
        await buildAndSaveFolderArtifacts(ctx);

        if (result.errors.length > 0) {
            // The per-file failures and the "(… K errors)" summary are already
            // printed above; signal a non-zero exit without re-reporting.
            throw new CliError('', 1);
        }
    },
};
