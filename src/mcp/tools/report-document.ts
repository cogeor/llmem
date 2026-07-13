/**
 * MCP tool: report_document (phase 2 of the documentation pair)
 *
 * C5 (2026-07-13): merges the former `report_file_info` +
 * `report_folder_info` tools. The payload is a discriminated union on
 * `kind: 'file' | 'folder'` over the shared doc-report contracts
 * (contracts/doc-reports.ts); phase-1 `document` pre-fills `kind` in its
 * callbackArgs, and this handler re-stats the path so a payload whose
 * `kind` contradicts the path's actual kind is a validation error, not a
 * mis-filed doc.
 *
 * Writes `.llmem/docs/{path}.md` (file) or `.llmem/docs/{path}/README.md`
 * (folder).
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
import { processFolderInfoReport } from '../../application/document-folder';
import {
    fileReportPayloadSchema,
    folderReportPayloadSchema,
} from '../../contracts/doc-reports';
import { asRelPath } from '../../core/paths';
import { getStoredContext } from '../server';
import { assertWorkspaceRootMatch } from './shared';

const routing = {
    workspaceRoot: z.string().describe('Absolute path to workspace root'),
    path: z.string().describe('Documented path (relative to workspace root)'),
};

export const ReportDocumentSchema = z.discriminatedUnion('kind', [
    fileReportPayloadSchema.extend({
        kind: z.literal('file').describe("Payload kind — 'file' as returned by the document tool"),
        ...routing,
    }),
    folderReportPayloadSchema.extend({
        kind: z.literal('folder').describe("Payload kind — 'folder' as returned by the document tool"),
        ...routing,
    }),
]);

export type ReportDocumentInput = z.infer<typeof ReportDocumentSchema>;

async function handleReportDocumentImpl(
    args: unknown
): Promise<McpResponse<unknown>> {
    const validation = validateRequest(ReportDocumentSchema, args);
    if (!validation.success) {
        return formatError(validation.error!);
    }
    const data = validation.data!;
    const { workspaceRoot, path: relativePath } = data;

    validateWorkspaceRoot(workspaceRoot);
    assertWorkspaceRootMatch(workspaceRoot);
    validateWorkspacePath(workspaceRoot, relativePath);

    const ctx = await getStoredContext();

    // kind-vs-path cross-check: a folder payload for a file path (or vice
    // versa) writes to the wrong shadow-tree location — reject instead.
    const rel = asRelPath(relativePath.replace(/\\/g, '/'));
    let isDirectory: boolean;
    try {
        isDirectory = (await ctx.io.stat(rel)).isDirectory();
    } catch {
        return formatError(`Path not found in workspace: ${relativePath}`);
    }
    const actualKind = isDirectory ? 'folder' : 'file';
    if (actualKind !== data.kind) {
        return formatError(
            `Payload kind '${data.kind}' does not match the path — '${relativePath}' is a ${actualKind}. ` +
            `Call the document tool and use the kind it returns.`,
        );
    }

    if (data.kind === 'folder') {
        const result = await processFolderInfoReport(ctx, {
            folderPath: rel,
            overview: data.overview,
            inputs: data.inputs,
            outputs: data.outputs,
            keyFiles: data.key_files,
            architecture: data.architecture,
        });
        return formatSuccess({
            message: 'Folder documentation generated and saved',
            artifactPath: result.readmePath,
            content: result.designDocument,
        });
    }

    const result = await processFileInfoReport(ctx, {
        filePath: rel,
        overview: data.overview,
        inputs: data.inputs,
        outputs: data.outputs,
        functions: data.functions,
    });
    return formatSuccess({
        message: 'Design document generated and saved',
        artifactPath: result.docPath,
        designDocument: result.designDocument,
    });
}

export const handleReportDocument = (args: unknown) =>
    withObservation(
        getDefaultObserver(),
        {
            requestId: generateCorrelationId(),
            method: 'tools/call',
            toolName: 'report_document',
        },
        handleReportDocumentImpl
    )(args);

export const reportDocumentTool = {
    name: 'report_document',
    description:
        'Store LLM-enriched documentation for a file or folder (discriminated by kind, as ' +
        'returned by the document tool). Saves to .llmem/docs/{path}.md for files or ' +
        '.llmem/docs/{path}/README.md for folders.',
    schema: ReportDocumentSchema,
    handler: handleReportDocument,
};
