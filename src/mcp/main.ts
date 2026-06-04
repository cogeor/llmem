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
import { getMcpConfig } from './config';
import * as path from 'path';
import * as fs from 'fs';
import { createLogger } from '../common/logger';

const log = createLogger('mcp');

/**
 * Detect workspace root by walking up directory tree
 * looking for project markers
 */
function detectWorkspaceRoot(): string {
    // 1. Explicit env var (highest priority)
    if (process.env.LLMEM_WORKSPACE) {
        const workspace = process.env.LLMEM_WORKSPACE;
        log.info('Using LLMEM_WORKSPACE', { workspace });
        return workspace;
    }

    // 2. Auto-detect by walking up from cwd
    const markers = ['.git', 'package.json', '.llmem', '.arch', '.artifacts'];
    let current = process.cwd();
    const root = path.parse(current).root;

    while (current !== root) {
        for (const marker of markers) {
            const markerPath = path.join(current, marker);
            if (fs.existsSync(markerPath)) {
                log.info('Auto-detected workspace root', { current, marker });
                return current;
            }
        }
        current = path.dirname(current);
    }

    // 3. Fallback to cwd
    log.info('Using current directory as workspace', { cwd: process.cwd() });
    return process.cwd();
}

/**
 * Main entry point for the MCP server
 */
async function main(): Promise<void> {
    log.info('Starting LLMem MCP server...');

    // Detect workspace root
    const workspaceRoot = detectWorkspaceRoot();
    log.info('Workspace root resolved', { workspaceRoot });

    // Load MCP server config
    const config = getMcpConfig();
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
