/**
 * MCP tool: report_file_info
 *
 * Receives LLM-enriched documentation for a file and saves it to .arch/.
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
import { processFileInfoReport } from '../../application/document-file';
import { asWorkspaceRoot, asRelPath } from '../../core/paths';
import { assertWorkspaceRootMatch } from './shared';

export const ReportFileInfoSchema = z.object({
    workspaceRoot: z.string().describe('Absolute path to workspace root'),
    path: z.string().describe('File path (relative to workspace root)'),
    overview: z.string().describe('File overview summary'),
    inputs: z.string().optional().describe('What the file takes as input'),
    outputs: z.string().optional().describe('What the file produces'),
    functions: z.array(z.object({
        name: z.string().describe('Function name'),
        purpose: z.string().describe('What the function does'),
        implementation: z.string().describe('How it works (bullet points)'),
    })).describe('Enriched function documentation'),
});

export type ReportFileInfoInput = z.infer<typeof ReportFileInfoSchema>;

async function handleReportFileInfoImpl(
    args: unknown
): Promise<McpResponse<unknown>> {
    const validation = validateRequest(ReportFileInfoSchema, args);
    if (!validation.success) {
        return formatError(validation.error!);
    }

    const { workspaceRoot, path: relativePath, overview, inputs, outputs, functions } = validation.data!;

    validateWorkspaceRoot(workspaceRoot);
    assertWorkspaceRootMatch(workspaceRoot);
    validateWorkspacePath(workspaceRoot, relativePath);

    const result = await processFileInfoReport({
        workspaceRoot: asWorkspaceRoot(workspaceRoot),
        filePath: asRelPath(relativePath),
        overview,
        inputs,
        outputs,
        functions,
    });

    return formatSuccess({
        message: 'Design document generated and saved',
        artifactPath: result.archPath,
        designDocument: result.designDocument,
    });
}

export const handleReportFileInfo = (args: unknown) =>
    withObservation(
        getDefaultObserver(),
        {
            requestId: generateCorrelationId(),
            method: 'tools/call',
            toolName: 'report_file_info',
        },
        handleReportFileInfoImpl
    )(args);

export const reportFileInfoTool = {
    name: 'report_file_info',
    description: 'Store LLM-enriched documentation for a file. Saves the design document to .arch/{path}.md in the workspace.',
    schema: ReportFileInfoSchema,
    handler: handleReportFileInfo,
};
