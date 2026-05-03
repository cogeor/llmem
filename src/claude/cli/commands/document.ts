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
 *   payload, write the design doc to `.arch/`, print the absolute path of
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
 */

import * as fs from 'fs';
import { z } from 'zod';

import {
    buildDocumentFilePrompt,
    processFileInfoReport,
    type EnrichedFunction,
} from '../../../application/document-file';
import {
    buildDocumentFolderPrompt,
    processFolderInfoReport,
    type EnrichedFolderKeyFile,
} from '../../../application/document-folder';
import { WorkspaceIO } from '../../../workspace/workspace-io';
import { asWorkspaceRoot, asRelPath } from '../../../core/paths';
import { detectWorkspace } from '../workspace';
import type { CommandSpec } from '../registry';

// ============================================================================
// Wire-level report payload schemas
// ============================================================================
//
// These mirror the shape the MCP `report_file_info` / `report_folder_info`
// tools accept. They live at the CLI boundary because the wire shape is a
// CLI / MCP contract, not an application-domain type — the application
// layer takes already-validated EnrichedFunction[] / EnrichedFolderKeyFile[]
// arrays. Keep these in sync with `src/mcp/handlers.ts`.

const fileReportSchema = z.object({
    overview: z.string(),
    inputs: z.string().optional(),
    outputs: z.string().optional(),
    functions: z.array(z.object({
        name: z.string(),
        purpose: z.string(),
        implementation: z.string(),
    })).default([]),
});

const folderReportSchema = z.object({
    overview: z.string(),
    inputs: z.string().optional(),
    outputs: z.string().optional(),
    key_files: z.array(z.object({
        name: z.string(),
        summary: z.string(),
    })).default([]),
    architecture: z.string(),
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
    // Captures the positional arguments that main.ts collects into `flagMap._`.
    // Surfaces in `describe --json` as an internal flag so the loop 04 contract
    // test (which asserts every property has a `description`) keeps passing.
    _: z.array(z.string()).optional()
        .describe('(internal) Positional arguments routed by the dispatcher.'),
});

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
            scenario: 'Pipe the agent\'s JSON output back to write .arch/src/parser/extractor.ts.md',
            command: 'llmem document src/parser/extractor.ts --content-file -',
        },
    ],
    args: documentArgs,
    async run(args) {
        // ----- Step 6.1: resolve target path -----
        const targetPath = args.path ?? (args._ && args._[0]);
        if (!targetPath) {
            console.error('Error: a path argument is required (positional or --path).');
            process.exit(1);
        }

        // ----- Step 6.2: detect workspace + build IO -----
        // Intentionally NO `console.log(\`Workspace: ${workspace}\`)` here.
        // The `--prompt-only` path must produce machine-parseable stdout
        // (the prompt body and nothing else).
        const workspace = detectWorkspace(args.workspace);
        const root = asWorkspaceRoot(workspace);
        const io = await WorkspaceIO.create(root);

        // ----- Step 6.3: classify file vs folder via io.stat -----
        // ENOENT propagates to main.ts:236-241 which prints `Error: <message>` exit 1.
        const rel = asRelPath(targetPath.replace(/\\/g, '/'));
        const stat = await io.stat(rel);
        const isDirectory = stat.isDirectory();

        // ----- Step 6.4: --prompt-only branch -----
        if (args.promptOnly) {
            const prompt = isDirectory
                ? (await buildDocumentFolderPrompt({
                    workspaceRoot: root, folderPath: rel, io,
                })).prompt
                : (await buildDocumentFilePrompt({
                    workspaceRoot: root, filePath: rel, io,
                })).prompt;
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
            console.error(
                'Pass --prompt-only to get the prompt, then pipe the LLM output back via ' +
                '--content-file -. (Direct LLM invocation is post-v1.)',
            );
            process.exit(1);
        }

        // ----- Step 6.7: parse payload + dispatch -----
        let parsed: unknown;
        try {
            parsed = JSON.parse(payload);
        } catch (err) {
            console.error(
                `Error: --content / --content-file payload is not valid JSON: ` +
                `${(err as Error).message}`,
            );
            process.exit(1);
        }

        if (isDirectory) {
            const r = folderReportSchema.parse(parsed);
            const result = await processFolderInfoReport({
                workspaceRoot: root,
                folderPath: rel,
                overview: r.overview,
                inputs: r.inputs,
                outputs: r.outputs,
                keyFiles: r.key_files satisfies EnrichedFolderKeyFile[],
                architecture: r.architecture,
                io,
            });
            // Forward-slash normalization for cross-platform stdout.
            process.stdout.write(result.readmePath.replace(/\\/g, '/') + '\n');
        } else {
            const r = fileReportSchema.parse(parsed);
            const result = await processFileInfoReport({
                workspaceRoot: root,
                filePath: rel,
                overview: r.overview,
                inputs: r.inputs,
                outputs: r.outputs,
                functions: r.functions satisfies EnrichedFunction[],
                io,
            });
            process.stdout.write(result.archPath.replace(/\\/g, '/') + '\n');
        }
    },
};
