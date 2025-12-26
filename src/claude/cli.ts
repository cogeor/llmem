#!/usr/bin/env node
/**
 * LLMem CLI for Claude Code
 *
 * Command-line interface for graph server and utilities.
 *
 * Usage:
 *   npm run serve              # Start server (auto-detects workspace)
 *   npm run serve -- --port 8080   # Start on custom port
 *   npm run serve -- --regenerate  # Force regenerate before serving
 */

import * as path from 'path';
import * as fs from 'fs';
import { GraphServer } from './server';
import { hasEdgeLists, generateGraph, getGraphStats } from './web-launcher';
import { main as startMcpServer } from './index';

/**
 * Parse command line arguments
 */
function parseArgs(): {
    port: number;
    workspace?: string;
    regenerate: boolean;
    open: boolean;
    verbose: boolean;
    command: 'serve' | 'generate' | 'stats' | 'mcp';
} {
    const args = process.argv.slice(2);
    const result = {
        port: 3000,
        workspace: undefined as string | undefined,
        regenerate: false,
        open: false,
        verbose: false,
        command: 'serve' as 'serve' | 'generate' | 'stats' | 'mcp',
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        switch (arg) {
            case '--port':
            case '-p':
                result.port = parseInt(args[++i], 10);
                if (isNaN(result.port)) {
                    console.error('Error: Invalid port number');
                    process.exit(1);
                }
                break;

            case '--workspace':
            case '-w':
                result.workspace = args[++i];
                break;

            case '--regenerate':
            case '-r':
                result.regenerate = true;
                break;

            case '--open':
            case '-o':
                result.open = true;
                break;

            case '--verbose':
            case '-v':
                result.verbose = true;
                break;

            case 'serve':
            case 'generate':
            case 'stats':
            case 'mcp':
                result.command = arg;
                break;

            case '--help':
            case '-h':
                printHelp();
                process.exit(0);
                break;

            default:
                if (arg.startsWith('-')) {
                    console.error(`Unknown option: ${arg}`);
                    console.error('Use --help for usage information');
                    process.exit(1);
                }
                break;
        }
    }

    return result;
}

/**
 * Detect workspace root
 */
function detectWorkspace(explicit?: string): string {
    if (explicit) {
        if (!fs.existsSync(explicit)) {
            console.error(`Error: Workspace not found: ${explicit}`);
            process.exit(1);
        }
        return path.resolve(explicit);
    }

    // Auto-detect
    const markers = ['.git', 'package.json', '.llmem', '.arch', '.artifacts'];
    let current = process.cwd();
    const root = path.parse(current).root;

    while (current !== root) {
        for (const marker of markers) {
            if (fs.existsSync(path.join(current, marker))) {
                return current;
            }
        }
        current = path.dirname(current);
    }

    // Fallback to cwd
    return process.cwd();
}

/**
 * Print help message
 */
function printHelp(): void {
    console.log(`
LLMem CLI - Graph Visualization and MCP Server

USAGE:
  llmem <command> [OPTIONS]
  npm run serve [OPTIONS]

COMMANDS:
  serve              Start HTTP server for webview (default)
  mcp                Start MCP server for Claude Code (stdio)
  generate           Generate graph without starting server
  stats              Show graph statistics

OPTIONS:
  --port, -p <num>       Port number (default: 3000)
  --workspace, -w <path> Workspace root (auto-detected)
  --regenerate, -r       Force regenerate graph before serving
  --open, -o             Open browser automatically
  --verbose, -v          Verbose logging
  --help, -h             Show this help

EXAMPLES:
  npm run serve
  npm run serve -- --port 8080
  npm run serve -- --regenerate --open
  npm run serve -- generate
  npm run serve -- stats

ENVIRONMENT:
  LLMEM_WORKSPACE        Workspace root directory
  LLMEM_ARTIFACT_ROOT    Artifact directory (default: .artifacts)
`);
}

/**
 * Command: Serve graph over HTTP
 */
async function commandServe(args: ReturnType<typeof parseArgs>): Promise<void> {
    const workspace = detectWorkspace(args.workspace);

    console.log(`Workspace: ${workspace}`);

    // Check if edge lists exist
    if (!hasEdgeLists(workspace)) {
        console.error('');
        console.error('Error: No edge lists found in workspace.');
        console.error('');
        console.error('Please scan your workspace first:');
        console.error('  1. Use the VSCode extension to toggle files/folders');
        console.error('  2. Or ask Claude to analyze your codebase');
        console.error('');
        process.exit(1);
    }

    // Regenerate if requested or if webview doesn't exist
    const webviewDir = path.join(workspace, '.artifacts', 'webview');
    const shouldRegenerate = args.regenerate || !fs.existsSync(webviewDir);

    if (shouldRegenerate) {
        console.log('Generating graph...');
        const result = await generateGraph({
            workspaceRoot: workspace,
            graphOnly: false,  // Generate full 3-panel UI by default
        });
        console.log(`✓ Graph generated: ${result.importNodeCount} files, ${result.importEdgeCount} imports`);
        console.log('');
    }

    // Start server
    const server = new GraphServer({
        workspaceRoot: workspace,
        port: args.port,
        openBrowser: args.open,
        verbose: args.verbose,
    });

    await server.start();

    // Handle Ctrl+C gracefully
    process.on('SIGINT', async () => {
        console.log('');
        console.log('Stopping server...');
        await server.stop();
        process.exit(0);
    });
}

/**
 * Command: Generate graph
 */
async function commandGenerate(args: ReturnType<typeof parseArgs>): Promise<void> {
    const workspace = detectWorkspace(args.workspace);

    console.log(`Workspace: ${workspace}`);

    if (!hasEdgeLists(workspace)) {
        console.error('Error: No edge lists found. Please scan workspace first.');
        process.exit(1);
    }

    console.log('Generating graph...');
    const result = await generateGraph({
        workspaceRoot: workspace,
        graphOnly: false,  // Generate full 3-panel UI by default
    });

    console.log('');
    console.log('✓ Graph generated successfully');
    console.log('');
    console.log(`  Files: ${result.importNodeCount}`);
    console.log(`  Imports: ${result.importEdgeCount}`);
    console.log(`  Functions: ${result.callNodeCount}`);
    console.log(`  Calls: ${result.callEdgeCount}`);
    console.log('');
    console.log(`  Output: ${result.indexPath}`);
    console.log(`  URL: ${result.url}`);
    console.log('');
}

/**
 * Command: Show statistics
 */
async function commandStats(args: ReturnType<typeof parseArgs>): Promise<void> {
    const workspace = detectWorkspace(args.workspace);

    console.log(`Workspace: ${workspace}`);

    if (!hasEdgeLists(workspace)) {
        console.error('Error: No edge lists found. Please scan workspace first.');
        process.exit(1);
    }

    const stats = await getGraphStats(workspace);

    console.log('');
    console.log('Graph Statistics:');
    console.log('');
    console.log('  Import Graph:');
    console.log(`    Nodes (files): ${stats.importNodes}`);
    console.log(`    Edges: ${stats.importEdges}`);
    console.log('');
    console.log('  Call Graph:');
    console.log(`    Nodes (functions): ${stats.callNodes}`);
    console.log(`    Edges: ${stats.callEdges}`);
    console.log('');
    console.log(`  Total Files: ${stats.fileCount}`);
    console.log(`  Last Updated: ${new Date(stats.lastUpdated).toLocaleString()}`);
    console.log('');
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
    const args = parseArgs();

    try {
        switch (args.command) {
            case 'serve':
                await commandServe(args);
                break;
            case 'mcp':
                // Start MCP server (delegates to index.ts)
                await startMcpServer();
                break;
            case 'generate':
                await commandGenerate(args);
                break;
            case 'stats':
                await commandStats(args);
                break;
        }
    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    main();
}

export { main };
