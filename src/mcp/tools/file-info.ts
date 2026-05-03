/**
 * MCP tool: file_info
 *
 * Extracts structural information from a source file and returns a prompt
 * for the host LLM to enrich into a design document.
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
import { asWorkspaceRoot, asRelPath } from '../../core/paths';
import { assertWorkspaceRootMatch } from './shared';

export const FileInfoSchema = z.object({
    workspaceRoot: z.string().describe('Absolute path to workspace root (current project directory)'),
    path: z.string().describe('Path to file (relative to workspace root)'),
});

export type FileInfoInput = z.infer<typeof FileInfoSchema>;

async function handleFileInfoImpl(
    args: unknown
): Promise<McpResponse<unknown>> {
    const validation = validateRequest(FileInfoSchema, args);
    if (!validation.success) {
        return formatError(validation.error!);
    }

    const { workspaceRoot, path: relativePath } = validation.data!;

    validateWorkspaceRoot(workspaceRoot);
    assertWorkspaceRootMatch(workspaceRoot);
    validateWorkspacePath(workspaceRoot, relativePath);

    const data = await buildDocumentFilePrompt({
        workspaceRoot: asWorkspaceRoot(workspaceRoot),
        filePath: asRelPath(relativePath),
    });

    return formatPromptResponse(
        data.prompt,
        'report_file_info',
        {
            workspaceRoot: workspaceRoot,
            path: relativePath,
        }
    );
}

export const handleFileInfo = (args: unknown) =>
    withObservation(
        getDefaultObserver(),
        {
            requestId: generateCorrelationId(),
            method: 'tools/call',
            toolName: 'file_info',
        },
        handleFileInfoImpl
    )(args);

export const fileInfoTool = {
    name: 'file_info',
    description: 'Get semantic documentation for a source file. Returns structural info and a prompt for LLM enrichment. You MUST process the returned prompt through the LLM first, then call report_file_info with the enriched result to save the documentation.',
    schema: FileInfoSchema,
    handler: handleFileInfo,
};
