/**
 * LLMem Claude Code MCP Server Entry Point
 *
 * Standalone MCP server for use with Claude Code.
 * Runs as a stdio-based MCP server that Claude can communicate with.
 *
 * Configuration:
 * - LLMEM_WORKSPACE: Explicit workspace root path
 * - Or auto-detects project root by walking up from cwd
 *
 * Usage in Claude Code:
 * Add to ~/.config/claude/config.json:
 * {
 *   "mcpServers": {
 *     "llmem": {
 *       "command": "node",
 *       "args": ["/path/to/llmem/dist/claude/index.js"],
 *       "env": {
 *         "LLMEM_WORKSPACE": "${workspaceFolder}"
 *       }
 *     }
 *   }
 * }
 */

import { startServer } from '../mcp/server';
import { getClaudeConfig } from './config';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Detect workspace root by walking up directory tree
 * looking for project markers
 */
function detectWorkspaceRoot(): string {
    // 1. Explicit env var (highest priority)
    if (process.env.LLMEM_WORKSPACE) {
        const workspace = process.env.LLMEM_WORKSPACE;
        console.error(`[Claude] Using LLMEM_WORKSPACE: ${workspace}`);
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
                console.error(`[Claude] Auto-detected workspace root: ${current} (found ${marker})`);
                return current;
            }
        }
        current = path.dirname(current);
    }

    // 3. Fallback to cwd
    console.error(`[Claude] Using current directory as workspace: ${process.cwd()}`);
    return process.cwd();
}

/**
 * Main entry point for Claude Code MCP server
 */
async function main(): Promise<void> {
    console.error('[Claude] Starting LLMem MCP server for Claude Code...');

    // Detect workspace root
    const workspaceRoot = detectWorkspaceRoot();
    console.error(`[Claude] Workspace root: ${workspaceRoot}`);

    // Load Claude-specific config
    const config = getClaudeConfig();
    console.error(`[Claude] Configuration:`);
    console.error(`[Claude]   Artifact root: ${config.artifactRoot}`);
    console.error(`[Claude]   Max files per folder: ${config.maxFilesPerFolder}`);
    console.error(`[Claude]   Max file size: ${config.maxFileSizeKB} KB`);

    // Start MCP server (reuses shared implementation)
    try {
        await startServer(config, workspaceRoot);
        console.error('[Claude] MCP server started successfully');
        console.error('[Claude] Ready to receive requests from Claude Code');
    } catch (error) {
        console.error('[Claude] Failed to start MCP server:', error);
        process.exit(1);
    }
}

// Run main when executed directly
if (require.main === module) {
    main().catch((error) => {
        console.error('[Claude] Fatal error:', error);
        process.exit(1);
    });
}

export { main, detectWorkspaceRoot };
