/**
 * MCP tool: report_folder_info
 *
 * Receives LLM-enriched documentation for a folder and saves the README
 * to .arch/<folder>/README.md.
 */

import { z } from 'zod';
import {
    McpResponse,
    validateRequest,
    formatSuccess,
    formatError,
    generateCorrelationId,
} from '../handlers';
import { getDefaultObserver, withObservation } from '../observer';
import {
    validateWorkspaceRoot,
    validateWorkspacePath,
} from '../path-utils';
import { processFolderInfoReport } from '../../application/document-folder';
import { asWorkspaceRoot, asRelPath } from '../../core/paths';
import { WorkspaceIO } from '../../workspace/workspace-io';
import { assertWorkspaceRootMatch } from './shared';

export const ReportFolderInfoSchema = z.object({
    workspaceRoot: z.string().describe('Absolute path to workspace root'),
    path: z.string().describe('Folder path (relative to workspace root)'),
    overview: z.string().describe('Folder overview summary'),
    inputs: z.string().optional().describe('What the folder takes as input (external dependencies)'),
    outputs: z.string().optional().describe('What the folder produces (public API)'),
    key_files: z.array(z.object({
        name: z.string().describe('File name'),
        summary: z.string().describe('Brief summary of the file goal'),
    })).describe('Key files in the folder'),
    architecture: z.string().describe('Description of the internal architecture and relationships'),
});

export type ReportFolderInfoInput = z.infer<typeof ReportFolderInfoSchema>;

async function handleReportFolderInfoImpl(
    args: unknown
): Promise<McpResponse<unknown>> {
    const validation = validateRequest(ReportFolderInfoSchema, args);
    if (!validation.success) {
        return formatError(validation.error!);
    }

    const { workspaceRoot, path: folderPath, overview, inputs, outputs, key_files, architecture } = validation.data!;

    validateWorkspaceRoot(workspaceRoot);
    assertWorkspaceRootMatch(workspaceRoot);
    validateWorkspacePath(workspaceRoot, folderPath);

    const io = await WorkspaceIO.create(asWorkspaceRoot(workspaceRoot));
    const result = await processFolderInfoReport({
        workspaceRoot: asWorkspaceRoot(workspaceRoot),
        folderPath: asRelPath(folderPath),
        overview,
        inputs,
        outputs,
        keyFiles: key_files,
        architecture,
        io,
    });

    return formatSuccess({
        message: 'Folder documentation generated and saved',
        artifactPath: result.readmePath,
        content: result.designDocument,
    });
}

export const handleReportFolderInfo = (args: unknown) =>
    withObservation(
        getDefaultObserver(),
        {
            requestId: generateCorrelationId(),
            method: 'tools/call',
            toolName: 'report_folder_info',
        },
        handleReportFolderInfoImpl
    )(args);

export const reportFolderInfoTool = {
    name: 'report_folder_info',
    description: 'Store LLM-enriched documentation for a folder. Saves the folder README to .arch/{path}/README.md in the workspace.',
    schema: ReportFolderInfoSchema,
    handler: handleReportFolderInfo,
};
