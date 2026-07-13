/**
 * Doc-report payload schemas — the wire shape of an LLM-enriched
 * file/folder documentation report.
 *
 * C4 (2026-07-13): the CLI `document` command and the MCP
 * `report_file_info` / `report_folder_info` tools accepted the SAME
 * payload but each declared its own Zod schema with a "keep in sync"
 * comment. Contracts is the layer chartered for typed boundary payloads
 * and sits below both faces, so the single declaration lives here:
 *
 * - CLI (`document --content/--content-file`): parses the bare payload.
 * - MCP (phase-2 tools): `.extend()`s it with `workspaceRoot` + `path`
 *   routing fields.
 *
 * `functions` / `key_files` are REQUIRED here (the MCP face rejects a
 * report without them — pinned by tests/contracts/mcp-tool-schemas.test.ts;
 * an agent must not silently skip the enrichment). The CLI face relaxes
 * them to `.default([])` for hand-driven pipelines.
 */

import { z } from 'zod';

/** Payload of a FILE documentation report (report_file_info body). */
export const fileReportPayloadSchema = z.object({
    overview: z.string().describe('File overview summary'),
    inputs: z.string().optional().describe('What the file takes as input'),
    outputs: z.string().optional().describe('What the file produces'),
    functions: z.array(z.object({
        name: z.string().describe('Function name'),
        purpose: z.string().describe('What the function does'),
        implementation: z.string().describe('How it works (bullet points)'),
    })).describe('Enriched function documentation'),
});

export type FileReportPayload = z.infer<typeof fileReportPayloadSchema>;

/** Payload of a FOLDER documentation report (report_folder_info body). */
export const folderReportPayloadSchema = z.object({
    overview: z.string().describe('Folder overview summary'),
    inputs: z.string().optional().describe('What the folder takes as input (external dependencies)'),
    outputs: z.string().optional().describe('What the folder produces (public API)'),
    key_files: z.array(z.object({
        name: z.string().describe('File name'),
        summary: z.string().describe('Brief summary of the file goal'),
    })).describe('Key files in the folder'),
    architecture: z.string().describe('Description of the internal architecture and relationships'),
});

export type FolderReportPayload = z.infer<typeof folderReportPayloadSchema>;
