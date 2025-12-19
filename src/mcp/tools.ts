/**
 * MCP Tool Definitions and Handlers
 * 
 * Defines the tools exposed via MCP protocol.
 * 
 * NOTE: file_info and report_file_info are currently disabled pending edge list integration.
 */

import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
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
import { getStoredWorkspaceRoot } from './server';
import { getConfig } from '../extension/config';
import { generateStaticWebview } from '../webview/generator';
import { prepareWebviewDataFromEdgeList } from '../graph/webview-data';
import { EdgeListStore } from '../graph/edgelist';

// ============================================================================
// Project Root Detection
// ============================================================================

const PROJECT_MARKERS = ['.artifacts'];

/**
 * Find project root by walking up from startDir looking for .artifacts folder
 */
function findProjectRoot(startDir: string): string | null {
    let current = path.resolve(startDir);
    const root = path.parse(current).root;

    while (current !== root) {
        if (fs.existsSync(path.join(current, '.artifacts'))) {
            return current;
        }
        current = path.dirname(current);
    }
    return null;
}

/**
 * Get effective workspace root - tries multiple strategies
 */
function getEffectiveWorkspaceRoot(): string {
    // 1. Try stored workspace root (from extension)
    try {
        return getStoredWorkspaceRoot();
    } catch {
        // Not set, continue
    }

    // 2. Try LLMEM_WORKSPACE env var
    if (process.env.LLMEM_WORKSPACE) {
        return process.env.LLMEM_WORKSPACE;
    }

    // 3. Find project root from cwd
    const projectRoot = findProjectRoot(process.cwd());
    if (projectRoot) {
        console.error(`[MCP] Auto-detected project root: ${projectRoot}`);
        return projectRoot;
    }

    // 4. Fallback to cwd
    return process.cwd();
}

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

export const ModuleInfoSchema = z.object({
    path: z.string().describe('Path to folder (relative to workspace root)'),
});

export const ReportModuleInfoSchema = z.object({
    path: z.string().describe('Folder path'),
    overview: z.string().describe('Module overview summary'),
    inputs: z.string().optional().describe('What the module takes as input (external dependencies)'),
    outputs: z.string().optional().describe('What the module produces (public API)'),
    key_files: z.array(z.object({
        name: z.string().describe('File name'),
        summary: z.string().describe('Brief summary of the file goal'),
    })).describe('Key files in the module'),
    architecture: z.string().describe('Description of the internal architecture and relationships'),
});

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Get file info for semantic enrichment
 * 
 * Extracts file info and returns a prompt for the host LLM to generate
 * a detailed design document.
 */
export async function handleFileInfo(
    args: unknown
): Promise<McpResponse<unknown>> {
    const correlationId = generateCorrelationId();
    logRequest(correlationId, 'file_info', args);

    const validation = validateRequest(FileInfoSchema, args);
    if (!validation.success) {
        const response = formatError(validation.error!);
        logResponse(correlationId, response);
        return response;
    }

    const { path: relativePath } = validation.data!;

    try {
        const root = getEffectiveWorkspaceRoot();

        // Import MCP functions dynamically
        const { getFileInfoForMcp, buildEnrichmentPrompt } = await import('../info/mcp');

        // Get file info data
        const data = await getFileInfoForMcp(root, relativePath);

        // Build the enrichment prompt
        const prompt = buildEnrichmentPrompt(
            data.filePath,
            data.markdown,
            data.sourceCode
        );

        // Return prompt_ready response for host LLM to process
        const response = formatPromptResponse(
            prompt,
            'report_file_info',
            { path: relativePath }
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
 * Callback: Receive LLM enrichment and format as design document
 * 
 * Called by the host LLM after processing the file_info prompt.
 * Returns the formatted design document.
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

    const { path: filePath, overview, inputs, outputs, functions } = validation.data!;

    try {
        // Format as design document
        const lines: string[] = [];

        lines.push(`# DESIGN DOCUMENT: ${filePath}`);
        lines.push('');
        lines.push('> **Instructions:** This document serves as a blueprint for implementing the source code. Review the specifications below before writing code.');
        lines.push('');
        lines.push('---');
        lines.push('');

        lines.push('## FILE OVERVIEW');
        lines.push('');
        lines.push(overview);
        lines.push('');

        if (inputs) {
            lines.push(`**Inputs:** ${inputs}`);
            lines.push('');
        }
        if (outputs) {
            lines.push(`**Outputs:** ${outputs}`);
            lines.push('');
        }

        lines.push('---');
        lines.push('');
        lines.push('## FUNCTION SPECIFICATIONS');
        lines.push('');

        for (const func of functions) {
            lines.push(`### \`${func.name}\``);
            lines.push('');
            lines.push(`**Purpose:** ${func.purpose}`);
            lines.push('');
            lines.push('**Implementation:**');
            lines.push('');
            lines.push(func.implementation);
            lines.push('');
        }

        const designDoc = lines.join('\n');

        // Save to .arch/<path>/<file>.md
        const root = getEffectiveWorkspaceRoot();

        // Construct path: .arch/src/path/file.ext.md
        // Note: We use .md extension instead of .artifact for better readability
        const relativePath = filePath.startsWith(root)
            ? path.relative(root, filePath)
            : filePath;

        const artifactPath = path.join(root, '.arch', `${relativePath}.md`);

        // Ensure directory exists
        const artifactDir = path.dirname(artifactPath);
        if (!fs.existsSync(artifactDir)) {
            fs.mkdirSync(artifactDir, { recursive: true });
        }

        // Write the design document
        fs.writeFileSync(artifactPath, designDoc, 'utf-8');
        console.error(`[report_file_info] Saved to ${artifactPath}`);

        const response = formatSuccess({
            message: 'Design document generated and saved',
            artifactPath: artifactPath,
            designDocument: designDoc
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
 * Get module info for semantic enrichment
 * 
 * Summarizes a folder using the EdgeList graph and returns a prompt
 * for the LLM to generate high-level module documentation.
 */
export async function handleModuleInfo(
    args: unknown
): Promise<McpResponse<unknown>> {
    const correlationId = generateCorrelationId();
    logRequest(correlationId, 'module_info', args);

    const validation = validateRequest(ModuleInfoSchema, args);
    if (!validation.success) {
        const response = formatError(validation.error!);
        logResponse(correlationId, response);
        return response;
    }

    const { path: folderPath } = validation.data!;

    try {
        const root = getEffectiveWorkspaceRoot();

        // Import module info functions dynamically
        const { getModuleInfoForMcp, buildModuleEnrichmentPrompt } = await import('../info/module');

        const data = await getModuleInfoForMcp(root, folderPath);
        const prompt = buildModuleEnrichmentPrompt(folderPath, data);

        const response = formatPromptResponse(
            prompt,
            'report_module_info',
            { path: folderPath }
        );
        logResponse(correlationId, response);
        return response;

    } catch (error) {
        let root = 'unknown';
        try { root = getEffectiveWorkspaceRoot(); } catch { }

        const msg = error instanceof Error ? error.message : String(error);
        const response = formatError(`${msg} (Root: ${root})`);
        logResponse(correlationId, response);
        return response;
    }
}

/**
 * Callback: Receive LLM enrichment for module info
 * 
 * Called by the host LLM after processing the module_info prompt.
 * Saves the formatted module documentation to .arch/<folder>/README.md
 */
export async function handleReportModuleInfo(
    args: unknown
): Promise<McpResponse<unknown>> {
    const correlationId = generateCorrelationId();
    logRequest(correlationId, 'report_module_info', args);

    const validation = validateRequest(ReportModuleInfoSchema, args);
    if (!validation.success) {
        const response = formatError(validation.error!);
        logResponse(correlationId, response);
        return response;
    }

    const { path: folderPath, overview, inputs, outputs, key_files, architecture } = validation.data!;

    try {
        const lines: string[] = [];
        lines.push(`# MODULE: ${folderPath}`);
        lines.push('');
        lines.push('## Overview');
        lines.push(overview);
        lines.push('');

        if (inputs) lines.push(`**Inputs:** ${inputs}\n`);
        if (outputs) lines.push(`**Outputs:** ${outputs}\n`);

        lines.push('## Architecture');
        lines.push(architecture);
        lines.push('');

        lines.push('## Key Files');
        for (const file of key_files) {
            lines.push(`- **${file.name}**: ${file.summary}`);
        }

        const content = lines.join('\n');

        // Save to .arch/<folder>/README.md
        const root = getEffectiveWorkspaceRoot();
        const relativePath = folderPath.startsWith(root) ? path.relative(root, folderPath) : folderPath;
        const artifactPath = path.join(root, '.arch', relativePath, 'README.md');

        const artifactDir = path.dirname(artifactPath);
        if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });

        fs.writeFileSync(artifactPath, content, 'utf-8');
        console.error(`[report_module_info] Saved to ${artifactPath}`);

        const response = formatSuccess({
            message: 'Module documentation generated and saved',
            artifactPath: artifactPath,
            content: content
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
        const root = getStoredWorkspaceRoot();
        const fullPath = path.join(root, relativePath);

        if (!fs.existsSync(fullPath)) {
            const response = formatError(`File not found: ${relativePath}`);
            logResponse(correlationId, response);
            return response;
        }

        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        const totalLines = lines.length;

        if (startLine < 1 || endLine < startLine || startLine > totalLines) {
            const response = formatError(`Invalid line range: ${startLine}-${endLine} (file has ${totalLines} lines)`);
            logResponse(correlationId, response);
            return response;
        }

        const safeEnd = Math.min(endLine, totalLines);
        const selectedLines = lines.slice(startLine - 1, safeEnd);
        const snippet = selectedLines.join('\n');

        const response = formatSuccess(snippet);
        logResponse(correlationId, response);
        return response;

    } catch (error) {
        const response = formatError(error instanceof Error ? error.message : String(error));
        logResponse(correlationId, response);
        return response;
    }
}

/**
 * Set the workspace root dynamically - DISABLED (not needed with new architecture)
 */
export async function handleSetWorkspaceRoot(
    args: unknown
): Promise<McpResponse<unknown>> {
    const correlationId = generateCorrelationId();
    logRequest(correlationId, 'set_workspace_root', args);

    const response = formatError('set_workspace_root is disabled - workspace root is now derived from extension context');
    logResponse(correlationId, response);
    return response;
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
        const root = getStoredWorkspaceRoot();

        let safeConfig = { artifactRoot: '.artifacts', maxFilesPerFolder: 20, maxFileSizeKB: 512 };
        try {
            safeConfig = getConfig();
        } catch {
            // Fallback
        }

        const artifactDir = path.join(root, safeConfig.artifactRoot);

        // Load edge list and build graphs
        const edgeListStore = new EdgeListStore(artifactDir);
        await edgeListStore.load();
        const graphData = prepareWebviewDataFromEdgeList(edgeListStore.getData());

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
        const response = formatError(error instanceof Error ? error.message : String(error));
        logResponse(correlationId, response);
        return response;
    }
}

// ============================================================================
// Tool Definitions for Registration
// ============================================================================

export const toolDefinitions = [
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
        name: 'module_info',
        description: 'Get semantic documentation for a module folder. Returns structural info for files and prompts for LLM enrichment.',
        schema: ModuleInfoSchema,
        handler: handleModuleInfo,
    },
    {
        name: 'report_module_info',
        description: 'Store LLM-enriched documentation for a module.',
        schema: ReportModuleInfoSchema,
        handler: handleReportModuleInfo,
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

// Export schemas for external use
export type FileInfoInput = z.infer<typeof FileInfoSchema>;
export type ReportFileInfoInput = z.infer<typeof ReportFileInfoSchema>;
export type ModuleInfoInput = z.infer<typeof ModuleInfoSchema>;
export type ReportModuleInfoInput = z.infer<typeof ReportModuleInfoSchema>;
export type InspectSourceInput = z.infer<typeof InspectSourceSchema>;
export type SetWorkspaceRootInput = z.infer<typeof SetWorkspaceRootSchema>;
export type OpenWindowInput = z.infer<typeof OpenWindowSchema>;

// Alias for backwards compatibility
export const TOOLS = toolDefinitions;
