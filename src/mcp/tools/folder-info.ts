/**
 * MCP tool: folder_info
 *
 * Summarizes a folder using the EdgeList graph and returns a prompt
 * for the LLM to generate high-level folder documentation.
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
import { buildDocumentFolderPrompt } from '../../application/document-folder';
import { asWorkspaceRoot, asRelPath } from '../../core/paths';
import { assertWorkspaceRootMatch } from './shared';

export const FolderInfoSchema = z.object({
    workspaceRoot: z.string().describe('Absolute path to workspace root (current project directory)'),
    path: z.string().describe('Path to folder (relative to workspace root)'),
});

export type FolderInfoInput = z.infer<typeof FolderInfoSchema>;

async function handleFolderInfoImpl(
    args: unknown
): Promise<McpResponse<unknown>> {
    const validation = validateRequest(FolderInfoSchema, args);
    if (!validation.success) {
        return formatError(validation.error!);
    }

    const { workspaceRoot, path: folderPath } = validation.data!;

    validateWorkspaceRoot(workspaceRoot);
    assertWorkspaceRootMatch(workspaceRoot);
    validateWorkspacePath(workspaceRoot, folderPath);

    const data = await buildDocumentFolderPrompt({
        workspaceRoot: asWorkspaceRoot(workspaceRoot),
        folderPath: asRelPath(folderPath),
    });

    return formatPromptResponse(
        data.prompt,
        'report_folder_info',
        {
            workspaceRoot: workspaceRoot,
            path: folderPath,
        }
    );
}

export const handleFolderInfo = (args: unknown) =>
    withObservation(
        getDefaultObserver(),
        {
            requestId: generateCorrelationId(),
            method: 'tools/call',
            toolName: 'folder_info',
        },
        handleFolderInfoImpl
    )(args);

export const folderInfoTool = {
    name: 'folder_info',
    description: 'Get semantic documentation for a folder. Returns structural info for files and prompts for LLM enrichment. After calling this tool, you MUST call report_folder_info to save the enriched documentation.',
    schema: FolderInfoSchema,
    handler: handleFolderInfo,
};
