/**
 * MCP Tool Definitions and Implementations
 * 
 * Defines the 5 MCP tools exposed to Antigravity IDE:
 * - get_artifact: Retrieve a saved artifact
 * - list_artifacts: Query artifact index
 * - generate_artifact: Parse file and create artifact
 * - generate_prompt: Build prompt for host LLM
 * - store_llm_result: Store LLM output as artifact
 * 
 * STUB IMPLEMENTATION: Returns placeholder data.
 * See FUTURE MODULE INTEGRATION section in plan/2-mcp.txt for integration guide.
 */

import { z } from 'zod';
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

// ============================================================================
// Tool Schemas (Zod)
// ============================================================================

export const GetArtifactSchema = z.object({
    path: z.string().describe('Source file path (relative to workspace)'),
});

export const ListArtifactsSchema = z.object({
    directory: z.string().optional().describe('Filter by directory'),
    type: z.string().optional().describe('Filter by artifact type'),
});

export const GenerateArtifactSchema = z.object({
    path: z.string().describe('Source file path'),
    task: z.enum(['parse', 'annotate', 'summarize']).describe('Task type'),
    options: z.object({
        focusOn: z.array(z.string()).optional(),
    }).optional(),
});

export const GeneratePromptSchema = z.object({
    path: z.string().describe('Source file path'),
    task: z.enum(['annotate', 'summarize', 'document', 'test-plan']).describe('Prompt task type'),
});

export const StoreLlmResultSchema = z.object({
    path: z.string().describe('Source file path'),
    task: z.string().describe('Task that generated this result'),
    result: z.string().describe('LLM output to store'),
});

// Type inference from schemas
export type GetArtifactArgs = z.infer<typeof GetArtifactSchema>;
export type ListArtifactsArgs = z.infer<typeof ListArtifactsSchema>;
export type GenerateArtifactArgs = z.infer<typeof GenerateArtifactSchema>;
export type GeneratePromptArgs = z.infer<typeof GeneratePromptSchema>;
export type StoreLlmResultArgs = z.infer<typeof StoreLlmResultSchema>;

// ============================================================================
// Data Types
// ============================================================================

export interface ArtifactMetadata {
    path: string;
    sourcePath: string;
    type: string;
    createdAt: string;
    updatedAt: string;
}

export interface Artifact extends ArtifactMetadata {
    content: string;
}

// ============================================================================
// Tool Handlers (STUB IMPLEMENTATIONS)
// ============================================================================

/**
 * Get a saved artifact by path
 * 
 * STUB: Returns placeholder artifact
 * TODO: Import { getArtifact } from '../artifact/service' when implemented
 */
export async function handleGetArtifact(
    args: unknown
): Promise<McpResponse<Artifact>> {
    const correlationId = generateCorrelationId();
    logRequest(correlationId, 'get_artifact', args);

    // Validate input
    const validation = validateRequest(GetArtifactSchema, args);
    if (!validation.success) {
        const response = formatError(validation.error!);
        logResponse(correlationId, response);
        return response;
    }

    const { path } = validation.data!;

    // STUB: Return placeholder artifact
    // TODO: Replace with: const artifact = await getArtifact(path);
    const stubArtifact: Artifact = {
        path: `.artifacts/${path}.artifact`,
        sourcePath: path,
        type: 'structure',
        content: `STUB: Artifact content for ${path}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    const response = formatSuccess(stubArtifact);
    logResponse(correlationId, response);
    return response;
}

/**
 * List artifacts with optional filtering
 * 
 * STUB: Returns empty list
 * TODO: Import { listArtifacts } from '../artifact/service' when implemented
 */
export async function handleListArtifacts(
    args: unknown
): Promise<McpResponse<ArtifactMetadata[]>> {
    const correlationId = generateCorrelationId();
    logRequest(correlationId, 'list_artifacts', args);

    // Validate input
    const validation = validateRequest(ListArtifactsSchema, args);
    if (!validation.success) {
        const response = formatError(validation.error!);
        logResponse(correlationId, response);
        return response;
    }

    // STUB: Return empty list
    // TODO: Replace with: const artifacts = await listArtifacts(validation.data);
    const stubArtifacts: ArtifactMetadata[] = [];

    const response = formatSuccess(stubArtifacts);
    logResponse(correlationId, response);
    return response;
}

/**
 * Generate artifact by parsing a source file
 * 
 * STUB: Returns placeholder metadata
 * TODO: Import { extractCodeStructure } from '../parser/extractor' when implemented
 * TODO: Import { saveArtifact } from '../artifact/service' when implemented
 */
export async function handleGenerateArtifact(
    args: unknown
): Promise<McpResponse<ArtifactMetadata>> {
    const correlationId = generateCorrelationId();
    logRequest(correlationId, 'generate_artifact', args);

    // Validate input
    const validation = validateRequest(GenerateArtifactSchema, args);
    if (!validation.success) {
        const response = formatError(validation.error!);
        logResponse(correlationId, response);
        return response;
    }

    const { path, task } = validation.data!;

    // STUB: Return placeholder metadata
    // TODO: 
    // 1. const structure = await extractCodeStructure(path);
    // 2. const artifact = { path, sourcePath: path, type: task, content: JSON.stringify(structure), ... };
    // 3. await saveArtifact(artifact);
    const stubMetadata: ArtifactMetadata = {
        path: `.artifacts/${path}.artifact`,
        sourcePath: path,
        type: task,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    const response = formatSuccess(stubMetadata);
    logResponse(correlationId, response);
    return response;
}

/**
 * Generate a prompt for the host LLM
 * 
 * Returns a prompt_ready response with instructions for the host agent
 * to execute the prompt and call store_llm_result with the output.
 * 
 * STUB: Returns placeholder prompt
 * TODO: Import { buildPrompt } from '../llm/prompt-builder' when implemented
 * TODO: Import { extractCodeStructure } from '../parser/extractor' when implemented
 */
export async function handleGeneratePrompt(
    args: unknown
): Promise<McpResponse<never>> {
    const correlationId = generateCorrelationId();
    logRequest(correlationId, 'generate_prompt', args);

    // Validate input
    const validation = validateRequest(GeneratePromptSchema, args);
    if (!validation.success) {
        const response = formatError(validation.error!);
        logResponse(correlationId, response);
        return response;
    }

    const { path, task } = validation.data!;

    // STUB: Return placeholder prompt
    // TODO:
    // 1. const structure = await extractCodeStructure(path);
    // 2. const prompt = buildPrompt(task, structure);
    const stubPrompt = `STUB PROMPT: Please ${task} the code in ${path}.\n\nProvide your analysis in a structured format.`;

    const response = formatPromptResponse(
        stubPrompt,
        'store_llm_result',
        { path, task }
    );
    logResponse(correlationId, response);
    return response;
}

/**
 * Store LLM result as an artifact
 * 
 * Called by host agent after executing a prompt from generate_prompt.
 * 
 * STUB: Returns success without actually storing
 * TODO: Import { saveArtifact } from '../artifact/service' when implemented
 * TODO: Import { parseResult } from '../llm/prompt-builder' when implemented
 */
export async function handleStoreLlmResult(
    args: unknown
): Promise<McpResponse<ArtifactMetadata>> {
    const correlationId = generateCorrelationId();
    logRequest(correlationId, 'store_llm_result', args);

    // Validate input
    const validation = validateRequest(StoreLlmResultSchema, args);
    if (!validation.success) {
        const response = formatError(validation.error!);
        logResponse(correlationId, response);
        return response;
    }

    const { path, task, result } = validation.data!;

    // STUB: Return success without storing
    // TODO:
    // 1. const parsed = parseResult(result, task);
    // 2. const artifact = { path, sourcePath: path, type: task, content: parsed, ... };
    // 3. await saveArtifact(artifact);
    const stubMetadata: ArtifactMetadata = {
        path: `.artifacts/${path}.${task}.artifact`,
        sourcePath: path,
        type: task,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    console.error(`[${correlationId}] STUB: Would store LLM result (${result.length} chars) for ${path}`);

    const response = formatSuccess(stubMetadata);
    logResponse(correlationId, response);
    return response;
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

/**
 * Registry of all MCP tools
 */
export const TOOLS: ToolDefinition[] = [
    {
        name: 'get_artifact',
        description: 'Retrieve a saved artifact for a source file',
        schema: GetArtifactSchema,
        handler: handleGetArtifact,
    },
    {
        name: 'list_artifacts',
        description: 'List all artifacts, optionally filtered by directory or type',
        schema: ListArtifactsSchema,
        handler: handleListArtifacts,
    },
    {
        name: 'generate_artifact',
        description: 'Parse a source file and generate a structure artifact',
        schema: GenerateArtifactSchema,
        handler: handleGenerateArtifact,
    },
    {
        name: 'generate_prompt',
        description: 'Generate a prompt for the host LLM to analyze code',
        schema: GeneratePromptSchema,
        handler: handleGeneratePrompt,
    },
    {
        name: 'store_llm_result',
        description: 'Store the result of an LLM analysis as an artifact',
        schema: StoreLlmResultSchema,
        handler: handleStoreLlmResult,
    },
];
