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
    ensureArtifacts,
    saveFolderSummary,
    saveModuleSummaries,
    initializeArtifactService,
} from '../artifact/service';
import { readFile } from '../artifact/storage';
import { ArtifactRecord } from '../artifact/types';

// ============================================================================
// Tool Schemas (Zod)
// ============================================================================

export const GetArtifactsSchema = z.object({
    path: z.string().describe('Folder path to analyze'),
    recursive: z.boolean().optional().describe('Whether to search recursively').default(false),
});

export const StoreFolderSummarySchema = z.object({
    path: z.string().describe('Folder path'),
    summary: z.string().describe('Generated summary'),
});

export const StoreSummariesSchema = z.object({
    summaries: z.record(z.string()).describe('Map of folder paths to markdown summaries'),
});

export const ReadSourceCodeSchema = z.object({
    path: z.string().describe('Relative path to the source file'),
    startLine: z.number().describe('Start line number (1-indexed)'),
    endLine: z.number().describe('End line number (1-indexed)'),
});

export const SetWorkspaceRootSchema = z.object({
    root: z.string().describe('Absolute path to workspace root'),
});

// Type inference
export type GetArtifactsArgs = z.infer<typeof GetArtifactsSchema>;
export type StoreFolderSummaryArgs = z.infer<typeof StoreFolderSummarySchema>;
export type StoreSummariesArgs = z.infer<typeof StoreSummariesSchema>;
export type ReadSourceCodeArgs = z.infer<typeof ReadSourceCodeSchema>;
export type SetWorkspaceRootArgs = z.infer<typeof SetWorkspaceRootSchema>;

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Read specific lines of source code.
 */
export async function handleReadSourceCode(
    args: unknown
): Promise<McpResponse<string>> {
    const correlationId = generateCorrelationId();
    logRequest(correlationId, 'read_source_code', args);

    const validation = validateRequest(ReadSourceCodeSchema, args);
    if (!validation.success) {
        const response = formatError(validation.error!);
        logResponse(correlationId, response);
        return response;
    }

    const { path: relativePath, startLine, endLine } = validation.data!;

    try {
        // HACK: we use process.cwd() as workspaceRoot is internal to service
        const fullPath = path.join(process.cwd(), relativePath);

        const content = await readFile(fullPath);
        if (content === null) {
            const response = formatError(`File not found: ${relativePath}`);
            logResponse(correlationId, response);
            return response;
        }

        const lines = content.split('\n');
        // Validate range
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
 * Set the workspace root dynamically.
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
 * Get architectural insights for a folder.
 * Returns file signatures and triggers summary generation.
 */
export async function handleGetArtifacts(
    args: unknown
): Promise<McpResponse<never>> {
    const correlationId = generateCorrelationId();
    logRequest(correlationId, 'get_artifacts', args);

    // Validate input
    const validation = validateRequest(GetArtifactsSchema, args);
    if (!validation.success) {
        const response = formatError(validation.error!);
        logResponse(correlationId, response);
        return response;
    }

    const { path: folderPath, recursive } = validation.data!;

    try {
        const artifacts = await ensureArtifacts(folderPath, recursive);

        const contextMap: Record<string, any[]> = {};

        artifacts.forEach(r => {
            const dir = path.dirname(r.metadata.sourcePath);
            if (!contextMap[dir]) {
                contextMap[dir] = [];
            }
            try {
                const json = JSON.parse(r.content);
                contextMap[dir].push(json);
            } catch {
                contextMap[dir].push({ path: r.metadata.sourcePath, error: "Parse error" });
            }
        });

        const prompt = recursive
            ? `You are an Architectural Codebase Assistant.
Context: I have analyzed the folder tree starting at "${folderPath}".

Here is the structural data (Imports, Exports, Types, Signatures) grouped by folder:
${JSON.stringify(contextMap, null, 2)}

Task:
For EACH folder, perform a Strategic Analysis to generate a module summary.

**Strategic Planning Phase**:
1. Review the imports/exports to understand dependencies and public interface.
2. Identify critical functions or complex types that require deeper understanding.
3. IF you need to see implementation details, use the \`read_source_code\` tool to inspect specific blocks (e.g., verify how an import is used).
4. Do NOT verify everything—only what is ambiguous or critical.

**Output**:
After your analysis, trigger \`store_summaries\` with the Markdown summaries.
`
            : `You are an Architectural Codebase Assistant.
Context: I have analyzed the folder "${folderPath}".

Here is the structural data (Imports, Exports, Types, Signatures):
${JSON.stringify(contextMap[folderPath] || [], null, 2)}

Task:
Perform a Strategic Analysis of this module.

**Strategic Planning Phase**:
1. Review the interface (Exports) and dependencies (Imports).
2. Identify key data structures (Types).
3. Plan which functions need deep inspection to understand the *HOW*.
4. Use \`read_source_code\` to read specific line ranges if needed.

**Goal**:
Generate a comprehensive Markdown summary explaining:
1. Primary Responsibility.
2. Data Flow (Inputs -> Types -> Outputs).
3. Key Interactions.

Finally, call \`store_folder_summary\`.`;

        const nextTool = recursive ? 'store_summaries' : 'store_folder_summary';
        const nextArgs = recursive ? {} : { path: folderPath };

        const response = formatPromptResponse(
            prompt,
            nextTool, // This is just a suggestion in the prompt response
            nextArgs
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
 * Store the summary generated by the Host LLM.
 */
export async function handleStoreFolderSummary(
    args: unknown
): Promise<McpResponse<unknown>> {
    const correlationId = generateCorrelationId();
    logRequest(correlationId, 'store_folder_summary', args);

    // Validate input
    const validation = validateRequest(StoreFolderSummarySchema, args);
    if (!validation.success) {
        const response = formatError(validation.error!);
        logResponse(correlationId, response);
        return response;
    }

    const { path, summary } = validation.data!;

    try {
        const metadata = await saveFolderSummary(path, summary);
        const response = formatSuccess({
            message: "Folder summary saved successfully",
            metadata
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
 * Store multiple summaries at once.
 */
export async function handleStoreSummaries(
    args: unknown
): Promise<McpResponse<unknown>> {
    const correlationId = generateCorrelationId();
    logRequest(correlationId, 'store_summaries', args);

    const validation = validateRequest(StoreSummariesSchema, args);
    if (!validation.success) {
        const response = formatError(validation.error!);
        logResponse(correlationId, response);
        return response;
    }

    const { summaries } = validation.data!;

    try {
        const metadatas = await saveModuleSummaries(summaries);
        const response = formatSuccess({
            message: `Saved ${metadatas.length} summaries successfully`,
            metadatas
        });
        logResponse(correlationId, response);
        return response;
    } catch (error) {
        const response = formatError(error instanceof Error ? error.message : String(error));
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
        name: 'get_artifacts',
        description: 'Get architectural insights for a folder. Returns file signatures and triggers summary generation.',
        schema: GetArtifactsSchema,
        handler: handleGetArtifacts,
    },
    {
        name: 'store_folder_summary',
        description: 'Store the summary generated by the Host LLM for a folder.',
        schema: StoreFolderSummarySchema,
        handler: handleStoreFolderSummary,
    },
    {
        name: 'store_summaries',
        description: 'Store multiple folder summaries at once (recursive mode).',
        schema: StoreSummariesSchema,
        handler: handleStoreSummaries,
    },
    {
        name: 'read_source_code',
        description: 'Read a specific range of lines from a source file.',
        schema: ReadSourceCodeSchema,
        handler: handleReadSourceCode,
    },
    {
        name: 'set_workspace_root',
        description: 'Set the workspace root directory for the artifact service.',
        schema: SetWorkspaceRootSchema,
        handler: handleSetWorkspaceRoot,
    },
];
