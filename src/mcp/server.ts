/**
 * MCP Server Entry Point — thin barrel.
 *
 * Initializes the MCP server with stdio transport and registers all tools.
 * This is the primary interface between LLMem and the Antigravity IDE agent.
 *
 * Protocol: MCP (Model Context Protocol) over stdio
 * Transport: Standard input/output streams
 *
 * The implementation lives in `./server/`:
 *   - `./server/state`     — shared singleton state (the SINGLE source of the
 *                            `Server`/transport handles + stored config /
 *                            workspace-root / `WorkspaceContext`) and the
 *                            public stored-state getters/setters used by
 *                            `mcp/tools/*`.
 *   - `./server/lifecycle` — `startServer` / `stopServer` / `isServerRunning`
 *                            / `getServerConfig` + the Zod→JSON-schema helper.
 *
 * This file re-exports everything so existing importers (`from './server'`,
 * `from '../server'`, `from '../mcp/server'`) keep working unchanged.
 */

export * from './server/state';
export * from './server/lifecycle';
