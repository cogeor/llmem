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
import { Config } from '../extension/config';
import { TOOLS } from './tools';
import { generateCorrelationId } from './handlers';

// Use require to avoid TypeScript's deep type inference with zod-to-json-schema
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { zodToJsonSchema } = require('zod-to-json-schema');

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

// ============================================================================
// Server Lifecycle
// ============================================================================

import { initializeArtifactService } from '../artifact/service';

// ... imports

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
    const correlationId = generateCorrelationId();
    console.error(`[${correlationId}] Starting MCP server...`);

    // Initialize Artifact Service
    console.error(`[${correlationId}]   Workspace root: ${workspaceRoot}`);
    console.error(`[${correlationId}]   Artifact root: ${config.artifactRoot}`);

    await initializeArtifactService(workspaceRoot);

    // Create server instance
    server = new Server(
        {
            name: 'llmem',
            version: '0.1.0',
        },
        {
            capabilities: {
                tools: {},
            },
        }
    );

    // Register tool list handler
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        console.error(`[${correlationId}] Handling list_tools request`);
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

        console.error(`[${reqCorrelationId}] Tool call: ${toolName}`);

        // Find the tool
        const tool = TOOLS.find(t => t.name === toolName);
        if (!tool) {
            console.error(`[${reqCorrelationId}] Unknown tool: ${toolName}`);
            return {
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
            console.error(`[${reqCorrelationId}] Tool error: ${errorMessage}`);
            return {
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

    console.error(`[${correlationId}] MCP server started successfully`);
    console.error(`[${correlationId}]   Registered ${TOOLS.length} tools: ${TOOLS.map(t => t.name).join(', ')}`);
}

/**
 * Stop the MCP server
 * 
 * Gracefully shuts down the server and transport.
 * Called by extension.ts during deactivation.
 */
export async function stopServer(): Promise<void> {
    const correlationId = generateCorrelationId();
    console.error(`[${correlationId}] Stopping MCP server...`);

    if (server) {
        await server.close();
        server = null;
    }

    transport = null;
    serverConfig = null;

    console.error(`[${correlationId}] MCP server stopped`);
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
 * Uses default configuration when not started from the extension.
 */
async function main(): Promise<void> {
    // Default config for standalone mode
    const defaultConfig: Config = {
        artifactRoot: '.artifacts',
        maxFilesPerFolder: 20,
        maxFileSizeKB: 512,
    };

    try {
        await startServer(defaultConfig, process.cwd());
    } catch (error) {
        console.error('Failed to start MCP server:', error);
        process.exit(1);
    }
}

// Run main() when executed directly (not imported as module)
// Check if this file is the main module being run
const isMainModule = require.main === module;
if (isMainModule) {
    main();
}
