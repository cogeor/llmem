/**
 * MCP Tool Definitions and Handlers
 * 
 * Defines the tools exposed via MCP protocol.
 * Logic is delegated to src/info/mcp.ts for file_info.
 */

import { z } from 'zod';
import * as path from 'path';
import {
    McpResponse,
    validateRequest,
    formatSuccess,
    formatError,
    formatPromptResponse,
    generateCorrelationId,
    logRequest,
    logResponse,
} from './handlers';
import {
    initializeArtifactService,
    getWorkspaceRoot,
} from '../artifact/service';
import { readFile } from '../artifact/storage';
import { getConfig } from '../extension/config';
import { generateStaticWebview } from '../webview/generator';
import { prepareWebviewData } from '../graph/webview-data';
import {
    getFileInfoForMcp,
    buildEnrichmentPrompt,
    saveEnrichedFileInfo,
    EnrichedFileData,
} from '../info';

// ============================================================================
// Tool Schemas (Zod)
// ============================================================================

export const FileInfoSchema = z.object({
    path: z.string().describe('Path to file (relative to workspace root)'),
});

export const ReportFileInfoSchema = z.object({
    path: z.string().describe('File path'),
    overview: z.string().describe('File overview summary'),
    inputs: z.string().optional().describe('What the file takes as input'),
    outputs: z.string().optional().describe('What the file produces'),
    functions: z.array(z.object({
        name: z.string().describe('Function name'),
        purpose: z.string().describe('What the function does'),
        implementation: z.string().describe('How it works (bullet points)'),
    })).describe('Enriched function documentation'),
});

export const InspectSourceSchema = z.object({
    path: z.string().describe('Relative path to the source file'),
    startLine: z.number().describe('Start line number (1-indexed)'),
    endLine: z.number().describe('End line number (1-indexed)'),
});

export const SetWorkspaceRootSchema = z.object({
    root: z.string().describe('Absolute path to workspace root'),
});

export const OpenWindowSchema = z.object({
    viewColumn: z.number().optional().describe('View column to open in (1-3)'),
});

// Type inference
export type FileInfoArgs = z.infer<typeof FileInfoSchema>;
export type ReportFileInfoArgs = z.infer<typeof ReportFileInfoSchema>;
export type InspectSourceArgs = z.infer<typeof InspectSourceSchema>;
export type SetWorkspaceRootArgs = z.infer<typeof SetWorkspaceRootSchema>;
export type OpenWindowArgs = z.infer<typeof OpenWindowSchema>;

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Primary Entry Point: Get file info and prompt for LLM enrichment
 */
export async function handleFileInfo(
    args: unknown
): Promise<McpResponse<never>> {
    const correlationId = generateCorrelationId();
    logRequest(correlationId, 'file_info', args);

    const validation = validateRequest(FileInfoSchema, args);
    if (!validation.success) {
        const response = formatError(validation.error!);
        logResponse(correlationId, response);
        return response;
    }

    const { path: filePath } = validation.data!;

    try {
        const root = getWorkspaceRoot();
        const data = await getFileInfoForMcp(root, filePath);

        const prompt = buildEnrichmentPrompt(
            data.filePath,
            data.markdown,
            data.sourceCode
        );

        const response = formatPromptResponse(
            prompt,
            'report_file_info',
            { path: data.filePath }
        );
        logResponse(correlationId, response);
        return response;

    } catch (error) {
        const response = formatError(error instanceof Error ? error.message : String(error));
        logResponse(correlationId, response);
        return response;
    }
}

/**
 * Callback: Receive LLM enrichment and save to disk
 */
export async function handleReportFileInfo(
    args: unknown
): Promise<McpResponse<unknown>> {
    const correlationId = generateCorrelationId();
    logRequest(correlationId, 'report_file_info', args);

    const validation = validateRequest(ReportFileInfoSchema, args);
    if (!validation.success) {
        const response = formatError(validation.error!);
        logResponse(correlationId, response);
        return response;
    }

    const enrichedData = validation.data! as EnrichedFileData;

    try {
        const root = getWorkspaceRoot();

        // Re-fetch the original info for merging
        const data = await getFileInfoForMcp(root, enrichedData.path);

        const savedPath = await saveEnrichedFileInfo(root, data.info, enrichedData);

        const response = formatSuccess({
            message: `Enriched documentation saved`,
            path: savedPath
        });
        logResponse(correlationId, response);
        return response;

    } catch (error) {
        const response = formatError(error instanceof Error ? error.message : String(error));
        logResponse(correlationId, response);
        return response;
    }
}

/**
 * Inspect specific lines of source code.
 */
export async function handleInspectSource(
    args: unknown
): Promise<McpResponse<string>> {
    const correlationId = generateCorrelationId();
    logRequest(correlationId, 'inspect_source', args);

    const validation = validateRequest(InspectSourceSchema, args);
    if (!validation.success) {
        const response = formatError(validation.error!);
        logResponse(correlationId, response);
        return response;
    }

    const { path: relativePath, startLine, endLine } = validation.data!;

    try {
        let root = process.cwd();
        try {
            root = getWorkspaceRoot();
        } catch (e) {
            // fallback to cwd
        }

        const fullPath = path.join(root, relativePath);

        const content = await readFile(fullPath);
        if (content === null) {
            const response = formatError(`File not found: ${relativePath}`);
            logResponse(correlationId, response);
            return response;
        }

        const lines = content.split('\n');
        if (startLine < 1 || endLine > lines.length || startLine > endLine) {
            const response = formatError(`Invalid line range: ${startLine}-${endLine}. File has ${lines.length} lines.`);
            logResponse(correlationId, response);
            return response;
        }

        const snippet = lines.slice(startLine - 1, endLine).join('\n');

        const response = formatSuccess(snippet);
        logResponse(correlationId, response);
        return response;
    } catch (error) {
        const response = formatError(String(error));
        logResponse(correlationId, response);
        return response;
    }
}

/**
 * Set the workspace root dynamically (for standalone debugging).
 */
export async function handleSetWorkspaceRoot(
    args: unknown
): Promise<McpResponse<unknown>> {
    const correlationId = generateCorrelationId();
    logRequest(correlationId, 'set_workspace_root', args);

    const validation = validateRequest(SetWorkspaceRootSchema, args);
    if (!validation.success) {
        const response = formatError(validation.error!);
        logResponse(correlationId, response);
        return response;
    }

    const { root } = validation.data!;

    try {
        await initializeArtifactService(root);
        const response = formatSuccess({
            message: `Workspace root set to: ${root}`
        });
        logResponse(correlationId, response);
        return response;
    } catch (error) {
        const response = formatError(error instanceof Error ? error.message : String(error));
        logResponse(correlationId, response);
        return response;
    }
}

/**
 * Generate Static Webview for Browser Viewing
 */
export async function handleOpenWindow(
    args: unknown
): Promise<McpResponse<unknown>> {
    const correlationId = generateCorrelationId();
    logRequest(correlationId, 'open_window', args);

    const validation = validateRequest(OpenWindowSchema, args);
    if (!validation.success) {
        const response = formatError(validation.error!);
        logResponse(correlationId, response);
        return response;
    }

    try {
        const root = getWorkspaceRoot();

        let safeConfig = { artifactRoot: '.artifacts', maxFilesPerFolder: 20, maxFileSizeKB: 512 };
        try {
            safeConfig = getConfig();
        } catch {
            // Fallback
        }

        const artifactDir = path.join(root, safeConfig.artifactRoot);

        // Build Graphs
        const graphData = await prepareWebviewData(artifactDir);

        // Generate Webview
        const webviewDir = path.join(artifactDir, 'webview');
        const extensionRoot = path.resolve(__dirname, '..', '..');

        const indexPath = await generateStaticWebview(webviewDir, extensionRoot, graphData);

        const response = formatSuccess({
            message: 'Webview generated successfully.',
            url: `file://${indexPath.replace(/\\/g, '/')}`,
            note: 'Please open this URL in your browser to view the graph.',
        });
        logResponse(correlationId, response);
        return response;

    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const response = formatError(`Failed to generate webview: ${msg}`);
        logResponse(correlationId, response);
        return response;
    }
}

// ============================================================================
// Tool Registry
// ============================================================================

export interface ToolDefinition {
    name: string;
    description: string;
    schema: z.ZodSchema;
    handler: (args: unknown) => Promise<McpResponse<unknown>>;
}

export const TOOLS: ToolDefinition[] = [
    {
        name: 'file_info',
        description: 'Get semantic documentation for a source file. Returns structural info and prompts for LLM enrichment.',
        schema: FileInfoSchema,
        handler: handleFileInfo,
    },
    {
        name: 'report_file_info',
        description: 'Store LLM-enriched documentation for a file.',
        schema: ReportFileInfoSchema,
        handler: handleReportFileInfo,
    },
    {
        name: 'inspect_source',
        description: 'Read a specific range of lines from a source file.',
        schema: InspectSourceSchema,
        handler: handleInspectSource,
    },
    {
        name: 'set_workspace_root',
        description: 'Set the workspace root directory for the artifact service (debug/standalone only).',
        schema: SetWorkspaceRootSchema,
        handler: handleSetWorkspaceRoot,
    },
    {
        name: 'open_window',
        description: 'Open the LLMem Webview Panel in the IDE.',
        schema: OpenWindowSchema,
        handler: handleOpenWindow,
    },
];
