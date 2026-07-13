/**
 * MCP tool: document (phase 1 of the documentation pair)
 *
 * C5 (2026-07-13): merges the former `file_info` + `folder_info` tools —
 * they took the identical `{workspaceRoot, path, refresh}` payload and the
 * application layer already classifies file-vs-folder by stat (same
 * dispatch the CLI `document` command does). One tool halves what agents
 * must read to pick a documentation entry point.
 *
 * Returns structural info + an enrichment prompt for the host LLM; the
 * callback is `report_document` with the resolved `kind` pre-filled, so
 * phase 2 can verify the payload shape matches the path's actual kind.
 */

import { z } from 'zod';
import {
    McpResponse,
    validateRequest,
    formatError,
    formatPromptResponse,
    generateCorrelationId,
} from '../handlers';
import { getDefaultObserver, withObservation } from '../observer';
import {
    validateWorkspaceRoot,
    validateWorkspacePath,
} from '../path-utils';
import { buildDocumentFilePrompt } from '../../application/document-file';
import { buildDocumentFolderPrompt } from '../../application/document-folder';
import { asRelPath } from '../../core/paths';
import { getStoredContext } from '../server';
import { assertWorkspaceRootMatch } from './shared';

export const DocumentSchema = z.object({
    workspaceRoot: z.string().describe('Absolute path to workspace root (current project directory)'),
    path: z.string().describe('Path to a source FILE or FOLDER (relative to workspace root; kind is detected)'),
    refresh: z
        .enum(['auto', 'skip'])
        .default('auto')
        .describe(
            "Freshness mode. 'auto' (default) brings the target's edges up to " +
            'date before summarizing (warm = stat/manifest compare only; ' +
            "cold/changed = re-parse). 'skip' bypasses the freshness check and " +
            'projects the current stores as-is — use for back-to-back ' +
            'same-turn calls on a target you just refreshed.',
        ),
});

export type DocumentInput = z.infer<typeof DocumentSchema>;

async function handleDocumentImpl(
    args: unknown
): Promise<McpResponse<unknown>> {
    const validation = validateRequest(DocumentSchema, args);
    if (!validation.success) {
        return formatError(validation.error!);
    }

    const { workspaceRoot, path: relativePath, refresh } = validation.data!;

    validateWorkspaceRoot(workspaceRoot);
    assertWorkspaceRootMatch(workspaceRoot);
    validateWorkspacePath(workspaceRoot, relativePath);

    const ctx = await getStoredContext();

    // Classify file vs folder by stat — same dispatch as the CLI `document`
    // command. ENOENT surfaces as a formatted error, not a crash.
    const rel = asRelPath(relativePath.replace(/\\/g, '/'));
    let isDirectory: boolean;
    try {
        isDirectory = (await ctx.io.stat(rel)).isDirectory();
    } catch {
        return formatError(`Path not found in workspace: ${relativePath}`);
    }

    const kind = isDirectory ? 'folder' : 'file';
    const data = isDirectory
        ? await buildDocumentFolderPrompt(ctx, { folderPath: rel, refresh })
        : await buildDocumentFilePrompt(ctx, { filePath: rel, refresh });

    return formatPromptResponse(
        data.prompt,
        'report_document',
        {
            workspaceRoot,
            path: relativePath,
            kind,
        }
    );
}

export const handleDocument = (args: unknown) =>
    withObservation(
        getDefaultObserver(),
        {
            requestId: generateCorrelationId(),
            method: 'tools/call',
            toolName: 'document',
        },
        handleDocumentImpl
    )(args);

export const documentTool = {
    name: 'document',
    description:
        'Get semantic documentation for a source file OR folder (kind is auto-detected). ' +
        'Returns structural info and a prompt for LLM enrichment. You MUST process the ' +
        'returned prompt through the LLM first, then call report_document with the ' +
        'enriched result to save the documentation.',
    schema: DocumentSchema,
    handler: handleDocument,
};
