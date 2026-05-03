/**
 * MCP tool: inspect_source
 *
 * Reads a specific range of lines from a source file in the workspace.
 * Workspace root is taken from server initialization rather than the
 * caller; this tool is primarily used for quick inspections where the
 * workspace context is already known.
 */

import { z } from 'zod';
import * as fs from 'fs';
import {
    McpResponse,
    validateRequest,
    formatSuccess,
    formatError,
    generateCorrelationId,
} from '../handlers';
import { getDefaultObserver, withObservation } from '../observer';
import {
    validateWorkspacePath,
    readFileInWorkspace,
} from '../path-utils';
import { getStoredWorkspaceRoot } from '../server';

const INSPECT_SOURCE_MAX_LINES = 500;

export const InspectSourceSchema = z.object({
    path: z.string().describe('Relative path to the source file'),
    startLine: z.number().describe('Start line number (1-indexed)'),
    endLine: z.number().describe('End line number (1-indexed)'),
});

export type InspectSourceInput = z.infer<typeof InspectSourceSchema>;

export async function handleInspectSourceImpl(
    args: unknown
): Promise<McpResponse<string>> {
    const validation = validateRequest(InspectSourceSchema, args);
    if (!validation.success) {
        return formatError(validation.error!);
    }

    const { path: relativePath, startLine, endLine } = validation.data!;

    const root = getStoredWorkspaceRoot();
    const fullPath = validateWorkspacePath(root, relativePath);

    if (!fs.existsSync(fullPath)) {
        return formatError(`File not found: ${relativePath}`);
    }

    const content = readFileInWorkspace(root, relativePath);
    const lines = content.split('\n');
    const totalLines = lines.length;

    if (startLine < 1 || endLine < startLine || startLine > totalLines) {
        return formatError(`Invalid line range: ${startLine}-${endLine} (file has ${totalLines} lines)`);
    }

    if (endLine - startLine + 1 > INSPECT_SOURCE_MAX_LINES) {
        return formatError(
            `Line range too large: requested ${endLine - startLine + 1} lines, ` +
            `maximum is ${INSPECT_SOURCE_MAX_LINES}. Split the request into smaller ranges.`
        );
    }

    const safeEnd = Math.min(endLine, totalLines);
    const selectedLines = lines.slice(startLine - 1, safeEnd);
    const snippet = selectedLines.join('\n');

    return formatSuccess(snippet);
}

export const handleInspectSource = (args: unknown) =>
    withObservation(
        getDefaultObserver(),
        {
            requestId: generateCorrelationId(),
            method: 'tools/call',
            toolName: 'inspect_source',
        },
        handleInspectSourceImpl
    )(args);

export const inspectSourceTool = {
    name: 'inspect_source',
    description: 'Read a specific range of lines from a source file. The workspaceRoot is fixed at server initialization; use relative paths only.',
    schema: InspectSourceSchema,
    handler: handleInspectSource,
};
