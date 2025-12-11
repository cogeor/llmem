/**
 * MCP Request/Response Handlers
 * 
 * Provides validation and formatting utilities for MCP tool requests/responses.
 * Uses Zod for schema validation per best practices.
 */

import { z, ZodSchema, ZodError } from 'zod';

// ============================================================================
// Response Types
// ============================================================================

/**
 * Standard MCP response structure
 * 
 * Three response types:
 * - success: Operation completed, data returned
 * - error: Operation failed, error message provided
 * - prompt_ready: LLM prompt generated, host agent should execute and callback
 */
export interface McpResponse<T = unknown> {
    status: 'success' | 'error' | 'prompt_ready';
    data?: T;
    error?: string;

    // For chained calls (when status === 'prompt_ready')
    promptForHostLLM?: string;
    callbackTool?: string;
    callbackArgs?: Record<string, unknown>;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validation result from validateRequest
 */
export interface ValidationResult<T> {
    success: boolean;
    data?: T;
    error?: string;
}

/**
 * Validate request arguments against a Zod schema
 * 
 * @param schema - Zod schema to validate against
 * @param data - Raw input data to validate
 * @returns Validation result with typed data or error message
 */
export function validateRequest<T>(
    schema: ZodSchema<T>,
    data: unknown
): ValidationResult<T> {
    try {
        const parsed = schema.parse(data);
        return { success: true, data: parsed };
    } catch (err: unknown) {
        if (err instanceof ZodError) {
            const issues = err.issues.map((i: { path: (string | number)[]; message: string }) =>
                `${i.path.join('.')}: ${i.message}`);
            return { success: false, error: `Validation failed: ${issues.join(', ')}` };
        }
        return { success: false, error: 'Unknown validation error' };
    }
}

// ============================================================================
// Response Formatting
// ============================================================================

/**
 * Create a success response
 */
export function formatSuccess<T>(data: T): McpResponse<T> {
    return { status: 'success', data };
}

/**
 * Create an error response
 */
export function formatError(error: string): McpResponse<never> {
    return { status: 'error', error };
}

/**
 * Create a prompt_ready response for chained LLM calls
 * 
 * This tells the host agent to:
 * 1. Execute the prompt with its LLM
 * 2. Call the callback tool with the result
 */
export function formatPromptResponse(
    promptForHostLLM: string,
    callbackTool: string,
    callbackArgs: Record<string, unknown>
): McpResponse<never> {
    return {
        status: 'prompt_ready',
        promptForHostLLM,
        callbackTool,
        callbackArgs,
    };
}

// ============================================================================
// Logging Utilities
// ============================================================================

/**
 * Generate a correlation ID for request tracking
 */
export function generateCorrelationId(): string {
    return `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Log an MCP request with correlation ID
 */
export function logRequest(
    correlationId: string,
    toolName: string,
    args: unknown
): void {
    console.error(`[${correlationId}] MCP Request: ${toolName}`, JSON.stringify(args));
}

/**
 * Log an MCP response with correlation ID
 */
export function logResponse(
    correlationId: string,
    response: McpResponse<unknown>
): void {
    console.error(`[${correlationId}] MCP Response: ${response.status}`);
}
