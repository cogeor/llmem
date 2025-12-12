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
    saveModuleSummaries,
    initializeArtifactService,
    getWorkspaceRoot,
} from '../artifact/service';
import { readFile } from '../artifact/storage';

// ============================================================================
// Tool Schemas (Zod)
// ============================================================================

export const AnalyzeCodebaseSchema = z.object({
    path: z.string().describe('Folder path to analyze (recursive)'),
});

export const ReportAnalysisSchema = z.object({
    summaries: z.record(z.string()).describe('Map of folder paths to markdown summaries'),
});

export const InspectSourceSchema = z.object({
    path: z.string().describe('Relative path to the source file'),
    startLine: z.number().describe('Start line number (1-indexed)'),
    endLine: z.number().describe('End line number (1-indexed)'),
});

export const SetWorkspaceRootSchema = z.object({
    root: z.string().describe('Absolute path to workspace root'),
});

// Type inference
export type AnalyzeCodebaseArgs = z.infer<typeof AnalyzeCodebaseSchema>;
export type ReportAnalysisArgs = z.infer<typeof ReportAnalysisSchema>;
export type InspectSourceArgs = z.infer<typeof InspectSourceSchema>;
export type SetWorkspaceRootArgs = z.infer<typeof SetWorkspaceRootSchema>;

// ============================================================================
// Tool Handlers
// ============================================================================

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
        // Use the service's workspace root if available, otherwise fallback to CWD
        let root = process.cwd();
        try {
            root = getWorkspaceRoot();
        } catch (e) {
            // Service might not be initialized yet (though analyze_codebase does it)
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
 * Primary Entry Point: Analyze Codebase
 * 
 * 1. Checks artifacts for the given path (recursive).
 * 2. Generates a prompt for the Host using the artifact context.
 */
export async function handleAnalyzeCodebase(
    args: unknown
): Promise<McpResponse<never>> {
    const correlationId = generateCorrelationId();
    logRequest(correlationId, 'analyze_codebase', args);

    // Validate input
    const validation = validateRequest(AnalyzeCodebaseSchema, args);
    if (!validation.success) {
        const response = formatError(validation.error!);
        logResponse(correlationId, response);
        return response;
    }

    const { path: folderPath } = validation.data!;
    const recursive = true; // Always recursive

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

        // Add package.json and README.md if present in the target folder (for root summary)
        // We do this manually because they are not "artifacts" in the parser sense
        const extraFiles = ['package.json', 'README.md'];
        for (const file of extraFiles) {
            const filePath = path.join(folderPath, file);
            const content = await readFile(path.isAbsolute(filePath) ? filePath : path.join(getWorkspaceRoot(), filePath));
            if (content) {
                const dir = '.'; // Relative to the analyze root, these are at root
                // Actually contextMap keys are directory paths. 
                // If folderPath is root, artifacts returns paths like 'src/file.ts'.
                // We should align keys.
                // artifact sourcePath is relative to workspace root.
                // let's assume folderPath is relative to workspace root or absolute?
                // ensureArtifacts takes folderPath. `path.dirname` of artifact source path.

                // If we are at root, artifacts might be deep.
                // If we analyze 'src', artifacts are in 'src'.
                // If we analyze '.', we might get nothing if no TS files in root.

                // We want to attach these to the folderPath entry in contextMap?
                // Or just '.' if folderPath is root.
                // Let's use `path.relative` logic consistent with artifacts.

                // However, contextMap keys are currently directory names derived from artifacts.
                // If artifacts list is empty, contextMap is empty.
                // We need to ensure the root entry exists.

                let relativeDir = path.relative(getWorkspaceRoot(), path.isAbsolute(folderPath) ? folderPath : path.join(getWorkspaceRoot(), folderPath));
                if (relativeDir === '') relativeDir = '.';

                if (!contextMap[relativeDir]) {
                    contextMap[relativeDir] = [];
                }
                contextMap[relativeDir].push({
                    file: file,
                    content: content.slice(0, 2000) // Truncate to avoid context limit
                });
            }
        }

        const prompt = `You are an Architectural Codebase Assistant.
Context: I have analyzed the folder tree starting at "${folderPath}".

Here is the structural data (Imports, Exports, Types, Signatures) grouped by folder:
${JSON.stringify(contextMap, null, 2)}

Task:
For EACH folder, perform a Strategic Analysis to generate a module summary.

**Strategic Planning Phase**:
1. Review the imports/exports to understand dependencies and public interface.
2. Identify critical functions or complex types that require deeper understanding.
3. IF you need to see implementation details, use the \`inspect_source\` tool to inspect specific blocks (e.g., verify how an import is used).
4. Do NOT verify everything—only what is ambiguous or critical.

**Output**:
After your analysis, trigger \`report_analysis\` with the Markdown summaries.
`;

        const nextTool = 'report_analysis';
        const nextArgs = {};

        const response = formatPromptResponse(
            prompt,
            nextTool,
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
 * Report final analysis results (storage).
 */
export async function handleReportAnalysis(
    args: unknown
): Promise<McpResponse<unknown>> {
    const correlationId = generateCorrelationId();
    logRequest(correlationId, 'report_analysis', args);

    const validation = validateRequest(ReportAnalysisSchema, args);
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
        name: 'analyze_codebase',
        description: 'Start strategic analysis of the codebase. Returns context and prompts for summarization.',
        schema: AnalyzeCodebaseSchema,
        handler: handleAnalyzeCodebase,
    },
    {
        name: 'inspect_source',
        description: 'Read a specific range of lines from a source file.',
        schema: InspectSourceSchema,
        handler: handleInspectSource,
    },
    {
        name: 'report_analysis',
        description: 'Report and store generated summaries for modules.',
        schema: ReportAnalysisSchema,
        handler: handleReportAnalysis,
    },
    {
        name: 'set_workspace_root',
        description: 'Set the workspace root directory for the artifact service (debug/standalone only).',
        schema: SetWorkspaceRootSchema,
        handler: handleSetWorkspaceRoot,
    },
];
