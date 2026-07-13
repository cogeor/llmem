/**
 * MCP tool: report_file_info
 *
 * Receives LLM-enriched documentation for a file and saves it to .llmem/docs/.
 *
 * Loop 04: shares the server-side `WorkspaceContext` via
 * `getStoredContext()`.
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
import { fileReportPayloadSchema } from '../../contracts/doc-reports';
import { asRelPath } from '../../core/paths';
import { getStoredContext } from '../server';
import { assertWorkspaceRootMatch } from './shared';

// C4: the payload shape is the shared contract (contracts/doc-reports.ts —
// same schema the CLI `document` command parses); MCP adds routing fields.
export const ReportFileInfoSchema = fileReportPayloadSchema.extend({
    workspaceRoot: z.string().describe('Absolute path to workspace root'),
    path: z.string().describe('File path (relative to workspace root)'),
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

    const ctx = await getStoredContext();
    const result = await processFileInfoReport(ctx, {
        filePath: asRelPath(relativePath),
        overview,
        inputs,
        outputs,
        functions,
    });

    return formatSuccess({
        message: 'Design document generated and saved',
        artifactPath: result.docPath,
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
    description: 'Store LLM-enriched documentation for a file. Saves the design document to .llmem/docs/{path}.md in the workspace.',
    schema: ReportFileInfoSchema,
    handler: handleReportFileInfo,
};
