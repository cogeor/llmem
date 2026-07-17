/**
 * LLMem MCP Server Entry Point
 *
 * Standalone, stdio-based MCP server. Reads the workspace root from the
 * environment (or auto-detects it) and starts the shared MCP server.
 *
 * Configuration:
 * - LLMEM_WORKSPACE: Explicit workspace root path
 * - Or auto-detects project root by walking up from cwd
 *
 * Usage (Claude Code is one example MCP client):
 * 1. Install: npm link (from the llmem directory)
 * 2. Add to the client's MCP settings:
 * {
 *   "mcpServers": {
 *     "llmem": {
 *       "command": "llmem",
 *       "args": ["mcp"],
 *       "env": {
 *         "LLMEM_WORKSPACE": "/home/user/projects/myproject"
 *       }
 *     }
 *   }
 * }
 */

import { startServer, stopServer } from './server';
import { getMcpConfig, applyStoreResolution } from './config';
import { detectWorkspace } from '../workspace';
import { createLogger } from '../common/logger';

const log = createLogger('mcp');

/**
 * Detect workspace root: `LLMEM_WORKSPACE` env var first (throws
 * `WorkspaceNotFoundError` if set but nonexistent — `entry.ts` turns that
 * into a fatal exit-1), then marker walk-up from cwd, then cwd. Thin wrapper
 * over the shared `src/workspace/detect.ts` helper (same priority order),
 * kept for the log line and the existing export surface.
 */
function detectWorkspaceRoot(): string {
    const workspace = detectWorkspace();
    log.info('Workspace root detected', { workspace });
    return workspace;
}

/**
 * Main entry point for the MCP server
 */
async function main(): Promise<void> {
    log.info('Starting LLMem MCP server...');

    // Detect workspace root
    const workspaceRoot = detectWorkspaceRoot();
    log.info('Workspace root resolved', { workspaceRoot });

    // Load MCP server config. P1 portable store: LLMEM_STORE=global routes
    // artifacts to the per-user store keyed by the workspace path (unless
    // LLMEM_ARTIFACT_ROOT pinned an explicit root — higher precedence).
    const config = applyStoreResolution(getMcpConfig(), workspaceRoot);
    log.info('Configuration loaded', {
        artifactRoot: config.artifactRoot,
        maxFilesPerFolder: config.maxFilesPerFolder,
        maxFileSizeKB: config.maxFileSizeKB,
        maxFileLines: config.maxFileLines,
    });

    // Start MCP server (reuses shared implementation)
    try {
        await startServer(config, workspaceRoot);
        log.info('MCP server started successfully');
        log.info('Ready to receive requests from the MCP client');

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
        // fatal-bootstrap: startServer threw before any normal error
        // surface is wired; emit plainly so the operator still sees it.
        // eslint-disable-next-line no-console
        console.error('[MCP] Failed to start MCP server:', error);
        process.exit(1);
    }
}
// NOTE: no `if (require.main === module) main()` self-exec here. esbuild
// bundles every inlined module into one CJS file, so `require.main === module`
// is true even when this module is merely IMPORTED (e.g. by the CLI `mcp`
// subcommand bundled into dist/cli/main.js). A self-exec guard here therefore
// fired a SECOND bootstrap alongside the command's explicit `main()` call
// ("MCP server is already running"). The standalone stdio bundle gets a
// dedicated entry instead: `src/mcp/entry.ts` -> `dist/mcp/main.js`.

export { main, detectWorkspaceRoot };
