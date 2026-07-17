/**
 * `llmem document <path>` — generate the LLM prompt or save an LLM-enriched
 * design document for a workspace file or folder.
 *
 * Wraps the application-layer document services (`document-file.ts`,
 * `document-folder.ts`) — the same two-phase pipeline that the MCP
 * `file_info` / `report_file_info` and `folder_info` / `report_folder_info`
 * tools drive, exposed at the CLI so agents can shell out instead of
 * speaking MCP. See design/06 § Per-command specs → commands/document.ts.
 *
 * Flag summary:
 * - `--prompt-only`: print the LLM enrichment prompt to stdout and exit 0.
 *   Stdout is kept clean (no banner contamination) so the output is safe
 *   to pipe directly into an LLM.
 * - `--content '<json>'`: parse the JSON as the agent's `report_*_info`
 *   payload, write the design doc to `.llmem/docs/`, print the absolute path of
 *   the written file (forward-slash normalized) to stdout.
 * - `--content-file <path>`: same as `--content`, but the JSON is read
 *   from a file. Pass `-` to read stdin to EOF.
 *
 * `--content` and `--content-file` are mutually exclusive — when both are
 * set, `--content` wins (precedence is unambiguous; we warn but do not
 * fail).
 *
 * File-vs-folder dispatch is by `io.stat` on the resolved path (realpath
 * containment, ENOENT propagates to `main.ts`'s top-level catch).
 *
 * Loop 04: builds a single `WorkspaceContext` via `cli.createWorkspace`
 * and threads it through every application call (build / process for both
 * file and folder).
 */

import * as fs from 'fs';
import { z } from 'zod';

import {
    buildDocumentFilePrompt,
    processFileInfoReport,
    type EnrichedFunction,
} from '../../application/document-file';
import {
    buildDocumentFolderPrompt,
    processFolderInfoReport,
    type EnrichedFolderKeyFile,
} from '../../application/document-folder';
import { asRelPath } from '../../core/paths';
import {
    fileReportPayloadSchema,
    folderReportPayloadSchema,
} from '../../contracts/doc-reports';
import { detectWorkspace } from '../../workspace';
import type { CommandSpec } from '../registry';
import { CliError } from '../errors';

// ============================================================================
// Wire-level report payload schemas
// ============================================================================
//
// C4 (2026-07-13): the payload shapes are the SHARED contract in
// `src/contracts/doc-reports.ts` — the same Zod objects the MCP
// `report_file_info` / `report_folder_info` tools extend with their
// routing fields. One declaration; no keep-in-sync comment needed. The
// CLI face relaxes the enrichment arrays to `.default([])` (hand-driven
// pipelines may omit them); the MCP face keeps them required.

const fileReportSchema = fileReportPayloadSchema.extend({
    functions: fileReportPayloadSchema.shape.functions.default([]),
});
const folderReportSchema = folderReportPayloadSchema.extend({
    key_files: folderReportPayloadSchema.shape.key_files.default([]),
});

// ============================================================================
// Args
// ============================================================================

const documentArgs = z.object({
    path: z.string().optional()
        .describe('Workspace-relative path to a file or folder to document (positional accepted).'),
    promptOnly: z.boolean().default(false)
        .describe('Print the LLM prompt to stdout and exit 0.'),
    content: z.string().optional()
        .describe('Inline JSON payload — the agent\'s report_file_info / report_folder_info body.'),
    contentFile: z.string().optional()
        .describe('Path to a file containing the JSON payload, or "-" to read stdin to EOF.'),
    workspace: z.string().optional()
        .describe('Workspace root directory (auto-detected if omitted).'),
    artifactRoot: z.string().optional()
        .describe('Artifact store directory (absolute paths allowed, may be outside the workspace; overrides LLMEM_ARTIFACT_ROOT; default: .llmem/graph)'),
    // Captures the positional arguments that main.ts collects into `flagMap._`.
    // Surfaces in `describe --json` as an internal flag so the loop 04 contract
    // test (which asserts every property has a `description`) keeps passing.
    _: z.array(z.string()).optional()
        .describe('(internal) Positional arguments routed by the dispatcher.'),
}).strict();

// ============================================================================
// Command spec
// ============================================================================

export const documentCommand: CommandSpec<typeof documentArgs> = {
    name: 'document',
    description: 'Generate the LLM prompt or save an LLM-enriched design doc for a file or folder.',
    examples: [
        {
            scenario: 'Print the file documentation prompt',
            command: 'llmem document src/parser/extractor.ts --prompt-only',
        },
        {
            scenario: 'Print the folder documentation prompt',
            command: 'llmem document src/parser --prompt-only',
        },
        {
            scenario: 'Pipe the agent\'s JSON output back to write .llmem/docs/src/parser/extractor.ts.md',
            command: 'llmem document src/parser/extractor.ts --content-file -',
        },
    ],
    args: documentArgs,
    async run(args, cli) {
        // ----- Step 6.1: resolve target path -----
        const targetPath = args.path ?? (args._ && args._[0]);
        if (!targetPath) {
            throw new CliError('Error: a path argument is required (positional or --path).', 1);
        }

        // ----- Step 6.2: detect workspace + build context -----
        // Intentionally NO `console.log(\`Workspace: ${workspace}\`)` here.
        // The `--prompt-only` path must produce machine-parseable stdout
        // (the prompt body and nothing else).
        const workspace = detectWorkspace(args.workspace);
        const ctx = await cli.createWorkspace(workspace, { artifactRoot: args.artifactRoot });

        // ----- Step 6.3: classify file vs folder via io.stat -----
        // ENOENT propagates to main.ts:236-241 which prints `Error: <message>` exit 1.
        const rel = asRelPath(targetPath.replace(/\\/g, '/'));
        const stat = await ctx.io.stat(rel);
        const isDirectory = stat.isDirectory();

        // ----- Step 6.4: --prompt-only branch -----
        if (args.promptOnly) {
            const prompt = isDirectory
                ? (await buildDocumentFolderPrompt(ctx, { folderPath: rel })).prompt
                : (await buildDocumentFilePrompt(ctx, { filePath: rel })).prompt;
            process.stdout.write(prompt);
            if (!prompt.endsWith('\n')) process.stdout.write('\n');
            return;  // exit 0
        }

        // ----- Step 6.5: gather payload from --content or --content-file -----
        let payload: string | null = null;
        if (typeof args.content === 'string') {
            payload = args.content;
            if (typeof args.contentFile === 'string') {
                console.warn(
                    'Warning: both --content and --content-file supplied; ' +
                    'using --content (precedence rule).',
                );
            }
        } else if (typeof args.contentFile === 'string') {
            if (args.contentFile === '-') {
                // Synchronous stdin-to-EOF read (cross-platform Node idiom).
                payload = fs.readFileSync(0, 'utf8');
            } else {
                // Raw fs (NOT io.readFile) because the LLM-response file may
                // live outside the workspace (e.g. an agent piping to
                // `os.tmpdir()`). The file is the LLM's output, not source.
                payload = fs.readFileSync(args.contentFile, 'utf8');
            }
        }

        // ----- Step 6.6: helpful no-op -----
        if (payload === null) {
            throw new CliError(
                'Pass --prompt-only to get the prompt, then pipe the LLM output back via ' +
                '--content-file -. (Direct LLM invocation is post-v1.)',
                1,
            );
        }

        // ----- Step 6.7: parse payload + dispatch -----
        let parsed: unknown;
        try {
            parsed = JSON.parse(payload);
        } catch (err) {
            throw new CliError(
                `Error: --content / --content-file payload is not valid JSON: ` +
                `${(err as Error).message}`,
                1,
            );
        }

        if (isDirectory) {
            const r = folderReportSchema.parse(parsed);
            const result = await processFolderInfoReport(ctx, {
                folderPath: rel,
                overview: r.overview,
                inputs: r.inputs,
                outputs: r.outputs,
                keyFiles: r.key_files satisfies EnrichedFolderKeyFile[],
                architecture: r.architecture,
            });
            // Forward-slash normalization for cross-platform stdout.
            process.stdout.write(result.readmePath.replace(/\\/g, '/') + '\n');
        } else {
            const r = fileReportSchema.parse(parsed);
            const result = await processFileInfoReport(ctx, {
                filePath: rel,
                overview: r.overview,
                inputs: r.inputs,
                outputs: r.outputs,
                functions: r.functions satisfies EnrichedFunction[],
            });
            process.stdout.write(result.docPath.replace(/\\/g, '/') + '\n');
        }
    },
};
