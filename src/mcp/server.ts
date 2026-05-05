/**
 * MCP Server Entry Point
 * 
 * Initializes the MCP server with stdio transport and registers all tools.
 * This is the primary interface between LLMem and the Antigravity IDE agent.
 * 
 * Protocol: MCP (Model Context Protocol) over stdio
 * Transport: Standard input/output streams
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Config } from '../core/config-types';
import { DEFAULT_CONFIG } from '../config-defaults';
import { toolDefinitions as TOOLS } from './tools';
import { generateCorrelationId } from './handlers';
import { createLogger } from '../common/logger';
import {
    createWorkspaceContext,
    type WorkspaceContext,
} from '../application/workspace-context';

const log = createLogger('mcp-server');

// Use require to avoid TypeScript's deep type inference with zod-to-json-schema
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { zodToJsonSchema } = require('zod-to-json-schema');

// Read version from package.json at runtime
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PACKAGE_VERSION: string = require('../../package.json').version as string;

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * MCP tool input schema type
 */
type ToolInputSchema = {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
};

/**
 * Convert a Zod schema to a JSON schema compatible with MCP SDK
 */
function toToolInputSchema(schema: z.ZodSchema): ToolInputSchema {
    return zodToJsonSchema(schema) as ToolInputSchema;
}

// ============================================================================
// Server State
// ============================================================================

/** MCP server instance */
let server: Server | null = null;

/** Server transport */
let transport: StdioServerTransport | null = null;

/** Server configuration (passed from extension) */
let serverConfig: Config | null = null;

/** Workspace root for lazy artifact initialization */
let storedWorkspaceRoot: string | null = null;

/** Stored config for tools that need configuration (artifact paths, etc.) */
let storedConfig: Config | null = null;

/**
 * Loop 04: memoized `WorkspaceContext` for tools. The MCP server processes
 * one workspace per `startServer` call; the context is built lazily on
 * the first tool that calls `getStoredContext()` and reset on
 * `stopServer()` / `setStoredWorkspaceRoot(null)`.
 */
let storedContext: WorkspaceContext | null = null;

/**
 * Get the stored workspace root for lazy initialization
 */
export function getStoredWorkspaceRoot(): string {
    if (!storedWorkspaceRoot) {
        throw new Error('Workspace root not set. Call startServer first.');
    }
    return storedWorkspaceRoot;
}

/**
 * Loop 04: build (and memoize) a `WorkspaceContext` for the stored
 * workspace root. Tools that take per-call `workspaceRoot` arguments
 * call `assertWorkspaceRootMatch(workspaceRoot)` first, then call this
 * to share the server-side context.
 *
 * The cache is invalidated on `setStoredWorkspaceRoot(null)` and
 * `stopServer()` so test runs that swap workspaces do not reuse a stale
 * context.
 */
export async function getStoredContext(): Promise<WorkspaceContext> {
    if (!storedContext) {
        storedContext = await createWorkspaceContext({
            workspaceRoot: getStoredWorkspaceRoot(),
            configOverrides: { ...getStoredConfig() },
        });
    }
    return storedContext;
}

/**
 * Get the stored Config for tools (e.g. artifact root paths).
 * Throws if the server has not been initialized.
 */
export function getStoredConfig(): Config {
    if (!storedConfig) {
        throw new Error('Config not set. Call startServer first.');
    }
    return storedConfig;
}

/**
 * Set the stored workspace root directly (for testing only). Loop 04:
 * also resets the memoized `WorkspaceContext` so a follow-up
 * `getStoredContext()` rebuilds against the new root.
 */
export function setStoredWorkspaceRoot(root: string | null): void {
    storedWorkspaceRoot = root;
    storedContext = null;
}

/**
 * Set the stored config directly (for testing only). Loop 04: also
 * invalidates the memoized context so configuration overrides take
 * effect on the next access.
 */
export function setStoredConfig(config: Config | null): void {
    storedConfig = config;
    storedContext = null;
}

// ============================================================================
// Server Lifecycle
// ============================================================================

/**
 * Start the MCP server
 * 
 * Initializes the server with stdio transport and registers all tools.
 * Called by extension.ts during activation.
 * 
 * @param config - Extension configuration
 */
export async function startServer(config: Config, workspaceRoot: string): Promise<void> {
    if (server) {
        throw new Error('MCP server is already running');
    }

    serverConfig = config;
    storedConfig = config;
    const correlationId = generateCorrelationId();
    log.info('Starting MCP server...', { correlationId });

    // Store workspace root for lazy artifact initialization
    // Artifact service will be initialized on-demand when tools need it
    storedWorkspaceRoot = workspaceRoot;
    log.info('Workspace root stored for lazy init', { correlationId, workspaceRoot });
    log.info('Artifact root configured', { correlationId, artifactRoot: config.artifactRoot });

    // Create server instance
    server = new Server(
        {
            name: 'llmem',
            version: PACKAGE_VERSION,
        },
        {
            capabilities: {
                tools: {},
            },
        }
    );

    // Register tool list handler
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        log.debug('Handling list_tools request', { correlationId });
        return {
            tools: TOOLS.map(tool => ({
                name: tool.name,
                description: tool.description,
                inputSchema: toToolInputSchema(tool.schema),
            })),
        };
    });

    // Register tool call handler
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const toolName = request.params.name;
        const toolArgs = request.params.arguments ?? {};
        const reqCorrelationId = generateCorrelationId();

        log.debug('Tool call', { correlationId: reqCorrelationId, toolName });

        // Find the tool
        const tool = TOOLS.find(t => t.name === toolName);
        if (!tool) {
            log.warn('Unknown tool', { correlationId: reqCorrelationId, toolName });
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'error',
                            error: `Unknown tool: ${toolName}`,
                        }),
                    },
                ],
            };
        }

        // Execute the tool handler
        try {
            const result = await tool.handler(toolArgs);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(result),
                    },
                ],
            };
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            log.error('Tool error', { correlationId: reqCorrelationId, error: errorMessage });
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'error',
                            error: errorMessage,
                        }),
                    },
                ],
            };
        }
    });

    // Create and connect transport
    transport = new StdioServerTransport();
    await server.connect(transport);

    log.info('MCP server started successfully', { correlationId });
    log.info('Registered tools', {
        correlationId,
        count: TOOLS.length,
        tools: TOOLS.map(t => t.name).join(', '),
    });
}

/**
 * Stop the MCP server
 * 
 * Gracefully shuts down the server and transport.
 * Called by extension.ts during deactivation.
 */
export async function stopServer(): Promise<void> {
    const correlationId = generateCorrelationId();
    log.info('Stopping MCP server...', { correlationId });

    if (server) {
        await server.close();
        server = null;
    }

    transport = null;
    serverConfig = null;
    storedConfig = null;
    storedWorkspaceRoot = null;
    storedContext = null; // Loop 04: clear memoized context on shutdown

    log.info('MCP server stopped', { correlationId });
}

/**
 * Check if the server is currently running
 */
export function isServerRunning(): boolean {
    return server !== null;
}

/**
 * Get the current server configuration
 */
export function getServerConfig(): Config | null {
    return serverConfig;
}

// ============================================================================
// Standalone Entry Point
// ============================================================================

/**
 * Main entry point for standalone execution (when run via `node dist/mcp/server.js`)
 *
 * IMPORTANT: Requires LLMEM_WORKSPACE environment variable to be set.
 * This ensures the MCP server always has an explicit workspace context.
 *
 * Usage:
 *   LLMEM_WORKSPACE=/path/to/workspace node dist/mcp/server.js
 *
 * The workspace root is NEVER inferred from cwd to prevent accidentally
 * operating on the wrong directory (e.g., extension installation path).
 */
async function main(): Promise<void> {
    // Default config for standalone mode
    const defaultConfig: Config = { ...DEFAULT_CONFIG };

    // REQUIRE workspace root from environment variable
    const workspaceRoot = process.env.LLMEM_WORKSPACE;

    if (!workspaceRoot) {
        // fatal-bootstrap: process exits before any structured handler runs;
        // emit plainly to stderr so the message survives even if the logger
        // module never finishes initializing.
        // eslint-disable-next-line no-console
        console.error('[MCP] ERROR: LLMEM_WORKSPACE environment variable is required.');
        // eslint-disable-next-line no-console
        console.error('[MCP] Usage: LLMEM_WORKSPACE=/path/to/workspace node dist/mcp/server.js');
        // eslint-disable-next-line no-console
        console.error('[MCP] The workspace root must be explicitly provided - never inferred.');
        process.exit(1);
    }

    log.info('Standalone mode', { workspaceRoot });

    try {
        await startServer(defaultConfig, workspaceRoot);

        // Graceful shutdown handler
        const shutdown = async (signal: string) => {
            log.info('Received signal, shutting down gracefully', { signal });
            try {
                await stopServer();
            } catch (err) {
                log.error('Error during shutdown', {
                    error: err instanceof Error ? err.message : String(err),
                });
            }
            process.exit(0);
        };

        process.once('SIGTERM', () => shutdown('SIGTERM'));
        process.once('SIGINT', () => shutdown('SIGINT'));

        process.on('unhandledRejection', (reason) => {
            log.error('Unhandled rejection', {
                reason: reason instanceof Error ? reason.message : String(reason),
            });
        });
    } catch (error) {
        // fatal-bootstrap: startServer threw before normal logging is wired.
        // eslint-disable-next-line no-console
        console.error('[MCP] Failed to start MCP server:', error);
        process.exit(1);
    }
}

// Run main() when executed directly (not imported as module)
// Check if this file is the main module being run
const isMainModule = require.main === module;
if (isMainModule) {
    main();
}
