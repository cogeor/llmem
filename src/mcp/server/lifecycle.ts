/**
 * MCP Server — lifecycle.
 *
 * Owns `startServer` / `stopServer` / `isServerRunning` / `getServerConfig`
 * plus the Zod→JSON-schema helper and version/logger setup they need.
 *
 * The module-level singletons (the live `Server`/transport handles and the
 * stored config/workspace-root/context) live in `./state`; this module
 * reads and mutates them THROUGH the state accessors/mutators so there is a
 * single shared instance. There is no import back from `state.ts`, so no
 * circular dependency.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Config } from '../../core/config-types';
import { toolDefinitions as TOOLS } from '../tools';
import { generateCorrelationId } from '../handlers';
import { createLogger } from '../../common/logger';
import {
    getServer,
    setServer,
    setTransport,
    setServerConfig,
    getServerConfigState,
    setStoredConfig,
    setStoredWorkspaceRoot,
    clearStoredContext,
} from './state';

const log = createLogger('mcp-server');

// Use require to avoid TypeScript's deep type inference with zod-to-json-schema
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { zodToJsonSchema } = require('zod-to-json-schema');

// Read version from package.json at runtime
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PACKAGE_VERSION: string = require('../../../package.json').version as string;

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
 * Convert a Zod schema to a JSON schema compatible with MCP SDK.
 *
 * C5: a discriminated union (report_document) serializes as a bare
 * `{ anyOf: [...] }` with no top-level `type` — but the MCP wire contract
 * requires `inputSchema.type === 'object'`. Every union branch here IS an
 * object, so stamping `type: 'object'` alongside the `anyOf` is valid JSON
 * Schema and satisfies the SDK's tools/list validation.
 */
function toToolInputSchema(schema: z.ZodSchema): ToolInputSchema {
    const js = zodToJsonSchema(schema) as Record<string, unknown>;
    if (js.type !== 'object' && Array.isArray(js.anyOf)) {
        return { type: 'object', ...js } as ToolInputSchema;
    }
    return js as ToolInputSchema;
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
    if (getServer()) {
        throw new Error('MCP server is already running');
    }

    setServerConfig(config);
    setStoredConfig(config);
    const correlationId = generateCorrelationId();
    log.info('Starting MCP server...', { correlationId });

    // Store workspace root for lazy artifact initialization
    // Artifact service will be initialized on-demand when tools need it
    setStoredWorkspaceRoot(workspaceRoot);
    log.info('Workspace root stored for lazy init', { correlationId, workspaceRoot });
    log.info('Artifact root configured', { correlationId, artifactRoot: config.artifactRoot });

    // Create server instance
    const server = new Server(
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
    setServer(server);

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
    const transport = new StdioServerTransport();
    setTransport(transport);
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

    const server = getServer();
    if (server) {
        await server.close();
        setServer(null);
    }

    setTransport(null);
    setServerConfig(null);
    setStoredConfig(null);
    setStoredWorkspaceRoot(null);
    clearStoredContext(); // Loop 04: clear memoized context on shutdown

    log.info('MCP server stopped', { correlationId });
}

/**
 * Check if the server is currently running
 */
export function isServerRunning(): boolean {
    return getServer() !== null;
}

/**
 * Get the current server configuration
 */
export function getServerConfig(): Config | null {
    return getServerConfigState();
}

// NOTE: This module is a pure library — `startServer`/`stopServer` are the
// public surface. The standalone stdio entry point is `src/mcp/main.ts`
// (built to `dist/mcp/main.js`); the CLI `mcp` subcommand also delegates to
// it. A previous `if (require.main === module) main()` self-exec here caused
// a double-bootstrap ("MCP server is already running") once `main.ts` was
// bundled with this file, so the redundant standalone bootstrap was removed.
