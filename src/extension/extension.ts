/**
 * LLMem Extension Entry Point
 * 
 * Handles Antigravity IDE extension lifecycle:
 * - Activation: Load config, start MCP server
 * - Deactivation: Clean shutdown of MCP server
 */

import * as vscode from 'vscode';
import { loadConfig, getConfig, isConfigLoaded, resetConfig, Config } from './config';

/** Extension output channel for logging */
let outputChannel: vscode.OutputChannel | null = null;

/** Flag to track if MCP server is running (placeholder for Part 2) */
let mcpServerRunning = false;

/**
 * Log a message to the output channel
 */
function log(message: string): void {
    const timestamp = new Date().toISOString();
    outputChannel?.appendLine(`[${timestamp}] ${message}`);
}

/**
 * Activate the extension
 * 
 * Called when the extension is activated (on startup or first command).
 * Loads configuration and starts the MCP server.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel('LLMem');
    context.subscriptions.push(outputChannel);

    log('LLMem extension activating...');

    // Load configuration
    const config = loadConfig();
    log(`Configuration loaded successfully`);
    log(`  Artifact root: ${config.artifactRoot}`);

    // Register commands
    const showStatusCommand = vscode.commands.registerCommand('llmem.showStatus', () => {
        showStatus();
    });
    context.subscriptions.push(showStatusCommand);

    // Start MCP server (placeholder - will be implemented in Part 2)
    try {
        await startMcpServer(config);
        log('MCP server started successfully');
        mcpServerRunning = true;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`ERROR: Failed to start MCP server: ${errorMessage}`);
        vscode.window.showErrorMessage(`LLMem: Failed to start MCP server: ${errorMessage}`);
        return;
    }

    log('LLMem extension activated successfully');
    vscode.window.showInformationMessage('LLMem: Extension activated');
}

/**
 * Deactivate the extension
 * 
 * Called when the extension is deactivated.
 * Performs clean shutdown of MCP server.
 */
export async function deactivate(): Promise<void> {
    log('LLMem extension deactivating...');

    // Stop MCP server
    if (mcpServerRunning) {
        try {
            await stopMcpServer();
            log('MCP server stopped');
            mcpServerRunning = false;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log(`ERROR: Failed to stop MCP server cleanly: ${errorMessage}`);
        }
    }

    // Reset configuration
    resetConfig();

    log('LLMem extension deactivated');
}

/**
 * Show extension status
 */
function showStatus(): void {
    if (!isConfigLoaded()) {
        vscode.window.showWarningMessage('LLMem: Configuration not loaded.');
        return;
    }

    const config = getConfig();
    const statusMessage = [
        'LLMem Status:',
        `  MCP Server: ${mcpServerRunning ? 'Running' : 'Stopped'}`,
        `  Artifact Root: ${config.artifactRoot}`,
    ].join('\n');

    vscode.window.showInformationMessage(statusMessage);
    outputChannel?.show();
}

/**
 * Start the MCP server
 * 
 * Placeholder - will be implemented in Part 2 (MCP Server)
 */
async function startMcpServer(config: Config): Promise<void> {
    // TODO: Implement in Part 2
    // This will start the MCP server process and register tools
    log(`[Placeholder] Would start MCP server with artifact root: ${config.artifactRoot}`);

    // Simulate async startup
    await new Promise(resolve => setTimeout(resolve, 100));
}

/**
 * Stop the MCP server
 * 
 * Placeholder - will be implemented in Part 2 (MCP Server)
 */
async function stopMcpServer(): Promise<void> {
    // TODO: Implement in Part 2
    // This will gracefully stop the MCP server
    log('[Placeholder] Would stop MCP server');

    // Simulate async shutdown
    await new Promise(resolve => setTimeout(resolve, 100));
}
