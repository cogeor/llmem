/**
 * MCP Tool Definitions and Handlers
 *
 * Defines the tools exposed via MCP protocol.
 * All tools require explicit workspace root - no fallbacks or assumptions.
 *
 * IMPORTANT: This module is designed to be packaging-agnostic.
 * It works with VS Code extensions, Claude Code extensions, or standalone mode.
 * The workspace root is ALWAYS provided explicitly by the client - never inferred.
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
} from './handlers';
import { getDefaultObserver, withObservation } from './observer';
import {
    validateWorkspaceRoot,
    validateWorkspacePath,
    readFileInWorkspace,
} from './path-utils';
import { getStoredWorkspaceRoot } from './server';
import { getConfig } from '../extension/config';
import { DEFAULT_CONFIG } from '../config-defaults';
import { generateStaticWebview } from '../webview/generator';
import { prepareWebviewDataFromSplitEdgeLists } from '../graph/webview-data';
import { ImportEdgeListStore, CallEdgeListStore } from '../graph/edgelist';
import {
    buildDocumentFilePrompt,
    processFileInfoReport,
} from '../application/document-file';
import {
    buildDocumentFolderPrompt,
    processFolderInfoReport,
} from '../application/document-folder';
import { asWorkspaceRoot, asRelPath } from '../core/paths';

// ============================================================================
// Constants
// ============================================================================

const INSPECT_SOURCE_MAX_LINES = 500;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Assert that the caller-supplied workspaceRoot matches the server-stored root.
 * Throws a formatted error if they differ after resolution.
 */
function assertWorkspaceRootMatch(callerRoot: string): void {
    let stored: string;
    try {
        stored = getStoredWorkspaceRoot();
    } catch {
        // Server not yet initialized — fall through; validateWorkspaceRoot will catch invalid roots
        return;
    }
    const resolved = path.resolve(callerRoot);
    const storedResolved = path.resolve(stored);
    if (process.platform === 'win32') {
        if (resolved.toLowerCase() !== storedResolved.toLowerCase()) {
            throw new Error(
                `workspaceRoot mismatch: caller supplied '${callerRoot}' but server root is '${stored}'.`
            );
        }
    } else {
        if (resolved !== storedResolved) {
            throw new Error(
                `workspaceRoot mismatch: caller supplied '${callerRoot}' but server root is '${stored}'.`
            );
        }
    }
}

// ============================================================================
// Tool Schemas (Zod)
// ============================================================================

export const FileInfoSchema = z.object({
    workspaceRoot: z.string().describe('Absolute path to workspace root (current project directory)'),
    path: z.string().describe('Path to file (relative to workspace root)'),
});

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

export const InspectSourceSchema = z.object({
    path: z.string().describe('Relative path to the source file'),
    startLine: z.number().describe('Start line number (1-indexed)'),
    endLine: z.number().describe('End line number (1-indexed)'),
});

export const OpenWindowSchema = z.object({
    viewColumn: z.number().optional().describe('View column to open in (1-3)'),
});

export const FolderInfoSchema = z.object({
    workspaceRoot: z.string().describe('Absolute path to workspace root (current project directory)'),
    path: z.string().describe('Path to folder (relative to workspace root)'),
});

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

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Get file info for semantic enrichment
 *
 * Extracts file info and returns a prompt for the host LLM to generate
 * a detailed design document.
 */
async function handleFileInfoImpl(
    args: unknown
): Promise<McpResponse<unknown>> {
    const validation = validateRequest(FileInfoSchema, args);
    if (!validation.success) {
        return formatError(validation.error!);
    }

    const { workspaceRoot, path: relativePath } = validation.data!;

    // Validate workspace root
    validateWorkspaceRoot(workspaceRoot);
    assertWorkspaceRootMatch(workspaceRoot);

    // Validate path stays within workspace
    validateWorkspacePath(workspaceRoot, relativePath);

    // Build the design-doc prompt via the application-layer service.
    // The branded WorkspaceRoot is the only source of truth for path
    // resolution; no `process.cwd()` involvement.
    const data = await buildDocumentFilePrompt({
        workspaceRoot: asWorkspaceRoot(workspaceRoot),
        filePath: asRelPath(relativePath),
    });

    // Return prompt_ready response for host LLM to process
    return formatPromptResponse(
        data.prompt,
        'report_file_info',
        {
            workspaceRoot: workspaceRoot,
            path: relativePath,
        }
    );
}

export const handleFileInfo = (args: unknown) =>
    withObservation(
        getDefaultObserver(),
        {
            requestId: generateCorrelationId(),
            method: 'tools/call',
            toolName: 'file_info',
        },
        handleFileInfoImpl
    )(args);

/**
 * Callback: Receive LLM enrichment and format as design document
 *
 * Called by the host LLM after processing the file_info prompt.
 * Returns the formatted design document and saves it to .arch/
 */
async function handleReportFileInfoImpl(
    args: unknown
): Promise<McpResponse<unknown>> {
    const validation = validateRequest(ReportFileInfoSchema, args);
    if (!validation.success) {
        return formatError(validation.error!);
    }

    const { workspaceRoot, path: relativePath, overview, inputs, outputs, functions } = validation.data!;

    // Validate workspace root
    validateWorkspaceRoot(workspaceRoot);
    assertWorkspaceRootMatch(workspaceRoot);

    // Validate path stays within workspace
    validateWorkspacePath(workspaceRoot, relativePath);

    // Persist via the application-layer service. The branded WorkspaceRoot
    // is the only source of truth for the destination — `process.cwd()`
    // is never consulted, so the README "Known Issue" workaround is no
    // longer needed.
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

/**
 * Get folder info for semantic enrichment
 *
 * Summarizes a folder using the EdgeList graph and returns a prompt
 * for the LLM to generate high-level folder documentation.
 */
async function handleFolderInfoImpl(
    args: unknown
): Promise<McpResponse<unknown>> {
    const validation = validateRequest(FolderInfoSchema, args);
    if (!validation.success) {
        return formatError(validation.error!);
    }

    const { workspaceRoot, path: folderPath } = validation.data!;

    // Validate workspace root
    validateWorkspaceRoot(workspaceRoot);
    assertWorkspaceRootMatch(workspaceRoot);

    // Validate path stays within workspace
    validateWorkspacePath(workspaceRoot, folderPath);

    // Build the folder-overview prompt via the application-layer service.
    // The branded WorkspaceRoot is the only source of truth for path
    // resolution; no `process.cwd()` involvement.
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

/**
 * Callback: Receive LLM enrichment for folder info
 *
 * Called by the host LLM after processing the folder_info prompt.
 * Saves the formatted folder documentation to .arch/<folder>/README.md
 */
async function handleReportFolderInfoImpl(
    args: unknown
): Promise<McpResponse<unknown>> {
    const validation = validateRequest(ReportFolderInfoSchema, args);
    if (!validation.success) {
        return formatError(validation.error!);
    }

    const { workspaceRoot, path: folderPath, overview, inputs, outputs, key_files, architecture } = validation.data!;

    // Validate workspace root
    validateWorkspaceRoot(workspaceRoot);
    assertWorkspaceRootMatch(workspaceRoot);

    // Validate path stays within workspace
    validateWorkspacePath(workspaceRoot, folderPath);

    // Persist via the application-layer service. The branded WorkspaceRoot
    // is the only source of truth for the destination — `process.cwd()`
    // is never consulted, so the README "Known Issue" workaround is no
    // longer needed.
    const result = await processFolderInfoReport({
        workspaceRoot: asWorkspaceRoot(workspaceRoot),
        folderPath: asRelPath(folderPath),
        overview,
        inputs,
        outputs,
        keyFiles: key_files,
        architecture,
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

/**
 * Inspect specific lines of source code
 *
 * NOTE: This tool uses stored workspace root from server initialization
 * rather than requiring it in parameters. This is because it's primarily
 * used for quick inspections where the workspace context is already known.
 */
export async function handleInspectSourceImpl(
    args: unknown
): Promise<McpResponse<string>> {
    const validation = validateRequest(InspectSourceSchema, args);
    if (!validation.success) {
        return formatError(validation.error!);
    }

    const { path: relativePath, startLine, endLine } = validation.data!;

    const root = getStoredWorkspaceRoot();

    // Validate path stays within workspace
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

/**
 * Generate Static Webview for Browser Viewing
 *
 * NOTE: This tool uses stored workspace root from server initialization.
 */
async function handleOpenWindowImpl(
    args: unknown
): Promise<McpResponse<unknown>> {
    const validation = validateRequest(OpenWindowSchema, args);
    if (!validation.success) {
        return formatError(validation.error!);
    }

    const root = getStoredWorkspaceRoot();

    let safeConfig = { ...DEFAULT_CONFIG };
    try {
        safeConfig = getConfig();
    } catch {
        // Fallback to defaults
    }

    const artifactDir = path.join(root, safeConfig.artifactRoot);

    // Load split edge lists and build graphs
    const importStore = new ImportEdgeListStore(artifactDir);
    const callStore = new CallEdgeListStore(artifactDir);
    await Promise.all([importStore.load(), callStore.load()]);
    const graphData = prepareWebviewDataFromSplitEdgeLists(importStore.getData(), callStore.getData());

    // Generate Webview
    const webviewDir = path.join(artifactDir, 'webview');
    const extensionRoot = path.resolve(__dirname, '..', '..');

    const indexPath = await generateStaticWebview(webviewDir, extensionRoot, root, graphData);

    return formatSuccess({
        message: 'Webview generated successfully.',
        url: `file://${indexPath.replace(/\\/g, '/')}`,
        note: 'Please open this URL in your browser to view the graph.',
    });
}

export const handleOpenWindow = (args: unknown) =>
    withObservation(
        getDefaultObserver(),
        {
            requestId: generateCorrelationId(),
            method: 'tools/call',
            toolName: 'open_window',
        },
        handleOpenWindowImpl
    )(args);

// ============================================================================
// Tool Definitions for Registration
// ============================================================================

export const toolDefinitions = [
    {
        name: 'file_info',
        description: 'Get semantic documentation for a source file. Returns structural info and a prompt for LLM enrichment. You MUST process the returned prompt through the LLM first, then call report_file_info with the enriched result to save the documentation.',
        schema: FileInfoSchema,
        handler: handleFileInfo,
    },
    {
        name: 'report_file_info',
        description: 'Store LLM-enriched documentation for a file. Saves the design document to .arch/{path}.md in the workspace.',
        schema: ReportFileInfoSchema,
        handler: handleReportFileInfo,
    },
    {
        name: 'folder_info',
        description: 'Get semantic documentation for a folder. Returns structural info for files and prompts for LLM enrichment. After calling this tool, you MUST call report_folder_info to save the enriched documentation.',
        schema: FolderInfoSchema,
        handler: handleFolderInfo,
    },
    {
        name: 'report_folder_info',
        description: 'Store LLM-enriched documentation for a folder. Saves the folder README to .arch/{path}/README.md in the workspace.',
        schema: ReportFolderInfoSchema,
        handler: handleReportFolderInfo,
    },
    {
        name: 'inspect_source',
        description: 'Read a specific range of lines from a source file. The workspaceRoot is fixed at server initialization; use relative paths only.',
        schema: InspectSourceSchema,
        handler: handleInspectSource,
    },
    {
        name: 'open_window',
        description: 'Open the LLMem graph visualization. In standalone mode (Claude Code CLI) this opens a file:// URL in the browser; in IDE mode (VS Code / Antigravity) it opens an integrated webview panel.',
        schema: OpenWindowSchema,
        handler: handleOpenWindow,
    },
];

// Export schemas for external use
export type FileInfoInput = z.infer<typeof FileInfoSchema>;
export type ReportFileInfoInput = z.infer<typeof ReportFileInfoSchema>;
export type FolderInfoInput = z.infer<typeof FolderInfoSchema>;
export type ReportFolderInfoInput = z.infer<typeof ReportFolderInfoSchema>;
export type InspectSourceInput = z.infer<typeof InspectSourceSchema>;
export type OpenWindowInput = z.infer<typeof OpenWindowSchema>;

// Alias for backwards compatibility
export const TOOLS = toolDefinitions;
