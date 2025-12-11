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
import {
    getArtifact,
    listArtifacts,
    createArtifact,
} from '../artifact/service';
import { ArtifactMetadata as ServiceArtifactMetadata } from '../artifact/types';

// ============================================================================
// Tool Schemas (Zod)
// ============================================================================

export const GetArtifactSchema = z.object({
    path: z.string().describe('Source file path (relative to workspace), artifact ID, or absolute artifact path'),
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

    try {
        const artifactRecord = await getArtifact(path);

        if (!artifactRecord) {
            return formatError(`Artifact not found for path: ${path}`);
        }

        const artifact: Artifact = {
            ...artifactRecord.metadata,
            path: artifactRecord.metadata.artifactPath,
            updatedAt: artifactRecord.metadata.createdAt, // Use createdAt as fallback
            content: artifactRecord.content,
        };

        const response = formatSuccess(artifact);
        logResponse(correlationId, response);
        return response;
    } catch (error) {
        const response = formatError(error instanceof Error ? error.message : String(error));
        logResponse(correlationId, response);
        return response;
    }
}

/**
 * List artifacts with optional filtering
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

    try {
        const { directory, type } = validation.data!;
        // The service listArtifacts takes { sourcePath?: string; type?: string }
        // directory filter is not directly supported by service.ts yet in this simple version, 
        // or we interpret directory as sourcePath prefix?
        // Let's assume for now we only support strict path or type match as per service.ts signature.
        // Or we pass undefined if not matching.

        const artifacts = await listArtifacts({
            sourcePath: directory,
            type
        });

        // Map to MCP ArtifactMetadata type
        const mappedArtifacts: ArtifactMetadata[] = artifacts.map((a: ServiceArtifactMetadata) => ({
            ...a,
            path: a.artifactPath,
            updatedAt: a.createdAt // Use createdAt as fallback
        }));

        const response = formatSuccess(mappedArtifacts);
        logResponse(correlationId, response);
        return response;
    } catch (error) {
        const response = formatError(error instanceof Error ? error.message : String(error));
        logResponse(correlationId, response);
        return response;
    }
}

/**
 * Generate artifact by parsing a source file
 * 
 * STUB: Returns placeholder metadata since Parser is not implemented,
 * but uses createArtifact to actually save the placeholder.
 */
export async function handleGenerateArtifact(
    args: unknown
): Promise<McpResponse<Artifact>> {
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

    try {
        // Real implementation would use Parser here.
        // For now, create a stub content.
        const stubContent = JSON.stringify({
            message: "This is a stub artifact generated by LLMem (Parser not yet implemented)",
            task: task,
            files: [path]
        }, null, 2);

        const metadata = await createArtifact(path, task, stubContent);

        const responseArtifact: Artifact = {
            ...metadata,
            path: metadata.artifactPath,
            updatedAt: metadata.createdAt,
            content: stubContent
        };

        const response = formatSuccess(responseArtifact);
        logResponse(correlationId, response);
        return response;
    } catch (error) {
        const response = formatError(error instanceof Error ? error.message : String(error));
        logResponse(correlationId, response);
        return response;
    }
}

/**
 * Generate a prompt for the host LLM
 * 
 * STUB: Remains mostly stubbed as depends on LLM module.
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

    try {
        // In real impl, we might parse the result first.
        const metadata = await createArtifact(path, task, result);

        const responseArtifact: ArtifactMetadata = {
            ...metadata,
            path: metadata.artifactPath,
            updatedAt: metadata.createdAt
        };

        const response = formatSuccess(responseArtifact);
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
