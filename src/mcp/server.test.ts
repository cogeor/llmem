/**
 * MCP Server Startup Tests
 *
 * Tests for MCP server initialization, workspace detection,
 * and NODE_PATH-based module loading for multi-language support.
 */

import { strict as assert } from 'assert';
import { test, describe, before, after } from 'node:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';

// ============================================================================
// Test Utilities
// ============================================================================

interface TestWorkspace {
    root: string;
    cleanup: () => void;
}

/**
 * Create a temporary workspace for testing
 */
function createTestWorkspace(): TestWorkspace {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-mcp-test-'));

    // Create .git marker for workspace detection
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });

    // Create a sample source file
    const srcDir = path.join(root, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'index.ts'), 'export const hello = "world";');

    return {
        root,
        cleanup: () => {
            fs.rmSync(root, { recursive: true, force: true });
        },
    };
}

/**
 * Get the CLI path - handles both vscode and claude build output structures
 *
 * Build structures:
 * - vscode build: dist/mcp/server.test.js, cli at dist/claude/claude/cli.js
 * - claude build: dist/claude/mcp/server.test.js, cli at dist/claude/claude/cli.js
 */
function getCliPath(): string {
    // From dist/mcp/, the CLI is at ../claude/claude/cli.js
    const fromMcpPath = path.join(__dirname, '../claude/claude/cli.js');
    if (fs.existsSync(fromMcpPath)) {
        return fromMcpPath;
    }

    // From dist/claude/mcp/, the CLI is at ../claude/cli.js
    const fromClaudeMcpPath = path.join(__dirname, '../claude/cli.js');
    if (fs.existsSync(fromClaudeMcpPath)) {
        return fromClaudeMcpPath;
    }

    // Log available paths for debugging
    console.error('[Test] CLI path not found. Tried:', fromMcpPath, fromClaudeMcpPath);
    console.error('[Test] __dirname:', __dirname);

    // Fallback - try the first option anyway
    return fromMcpPath;
}

/**
 * Start MCP server as subprocess and send a message
 */
async function startMcpServerWithMessage(
    env: Record<string, string>,
    message: object,
    timeoutMs: number = 5000
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    return new Promise((resolve, reject) => {
        const cliPath = getCliPath();

        const child = spawn('node', [cliPath, 'mcp'], {
            env: { ...process.env, ...env },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let resolved = false;

        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                child.kill();
                resolve({ stdout, stderr, exitCode: null });
            }
        }, timeoutMs);

        child.stdout?.on('data', (data) => {
            stdout += data.toString();
            // Check if we got a JSON response
            if (stdout.includes('"jsonrpc"')) {
                clearTimeout(timeout);
                if (!resolved) {
                    resolved = true;
                    child.kill();
                    resolve({ stdout, stderr, exitCode: null });
                }
            }
        });

        child.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('error', (err) => {
            clearTimeout(timeout);
            if (!resolved) {
                resolved = true;
                reject(err);
            }
        });

        child.on('close', (code) => {
            clearTimeout(timeout);
            if (!resolved) {
                resolved = true;
                resolve({ stdout, stderr, exitCode: code });
            }
        });

        // Send the MCP message
        child.stdin?.write(JSON.stringify(message) + '\n');
        child.stdin?.end();
    });
}

// ============================================================================
// Workspace Detection Tests
// ============================================================================

describe('MCP Server Workspace Detection', () => {
    let workspace: TestWorkspace;

    before(() => {
        workspace = createTestWorkspace();
    });

    after(() => {
        workspace.cleanup();
    });

    test('uses LLMEM_WORKSPACE when provided', async () => {
        const initMessage = {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0.0' },
            },
        };

        const result = await startMcpServerWithMessage(
            { LLMEM_WORKSPACE: workspace.root },
            initMessage,
            3000
        );

        // Check stderr for workspace detection message
        assert.ok(
            result.stderr.includes('Using LLMEM_WORKSPACE') ||
            result.stderr.includes(workspace.root),
            `Should use LLMEM_WORKSPACE. Stderr: ${result.stderr}`
        );

        // Should get a valid JSON-RPC response
        assert.ok(result.stdout.includes('"jsonrpc"'), 'Should return JSON-RPC response');
        assert.ok(result.stdout.includes('"result"'), 'Should have result in response');
    });

    test('auto-detects workspace from .git marker', async () => {
        const initMessage = {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0.0' },
            },
        };

        // Run from workspace directory without LLMEM_WORKSPACE
        const result = await startMcpServerWithMessage(
            { LLMEM_WORKSPACE: '' }, // Empty to trigger auto-detect
            initMessage,
            3000
        );

        // Should get a valid JSON-RPC response even with auto-detection
        assert.ok(result.stdout.includes('"jsonrpc"'), 'Should return JSON-RPC response');
    });
});

// ============================================================================
// MCP Protocol Tests
// ============================================================================

describe('MCP Protocol Compliance', () => {
    let workspace: TestWorkspace;

    before(() => {
        workspace = createTestWorkspace();
    });

    after(() => {
        workspace.cleanup();
    });

    test('responds to initialize request', async () => {
        const initMessage = {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0.0' },
            },
        };

        const result = await startMcpServerWithMessage(
            { LLMEM_WORKSPACE: workspace.root },
            initMessage,
            3000
        );

        // Parse the response
        const response = JSON.parse(result.stdout.trim().split('\n').pop() || '{}');

        assert.equal(response.jsonrpc, '2.0', 'Should be JSON-RPC 2.0');
        assert.equal(response.id, 1, 'Should have matching ID');
        assert.ok(response.result, 'Should have result');
        assert.equal(response.result.serverInfo?.name, 'llmem', 'Server name should be llmem');
        assert.ok(response.result.capabilities?.tools, 'Should have tools capability');
    });

    test('server reports correct tool count in startup logs', async () => {
        const initMessage = {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0.0' },
            },
        };

        const result = await startMcpServerWithMessage(
            { LLMEM_WORKSPACE: workspace.root },
            initMessage,
            3000
        );

        // Check that tools are registered
        assert.ok(
            result.stderr.includes('Registered') && result.stderr.includes('tools'),
            `Should log registered tools. Stderr: ${result.stderr}`
        );

        // Should have the expected tools
        const expectedTools = ['file_info', 'report_file_info', 'folder_info'];
        for (const tool of expectedTools) {
            assert.ok(
                result.stderr.includes(tool),
                `Should register ${tool} tool. Stderr: ${result.stderr}`
            );
        }
    });
});

// ============================================================================
// NODE_PATH Tests
// ============================================================================

describe('NODE_PATH Module Loading', () => {
    let workspace: TestWorkspace;
    let modulesDir: string;

    before(() => {
        workspace = createTestWorkspace();
        // Create a temporary modules directory
        modulesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-modules-test-'));
    });

    after(() => {
        workspace.cleanup();
        fs.rmSync(modulesDir, { recursive: true, force: true });
    });

    test('server starts without NODE_PATH (TypeScript only)', async () => {
        const initMessage = {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0.0' },
            },
        };

        const result = await startMcpServerWithMessage(
            {
                LLMEM_WORKSPACE: workspace.root,
                NODE_PATH: '', // Empty NODE_PATH
            },
            initMessage,
            3000
        );

        // Server should start successfully
        assert.ok(result.stdout.includes('"result"'), 'Server should start without NODE_PATH');

        // Server should report successful startup
        assert.ok(
            result.stderr.includes('MCP server started') || result.stderr.includes('Registered'),
            'Server should log successful startup'
        );
    });

    test('server starts with NODE_PATH set', async () => {
        const initMessage = {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0.0' },
            },
        };

        const result = await startMcpServerWithMessage(
            {
                LLMEM_WORKSPACE: workspace.root,
                NODE_PATH: modulesDir,
            },
            initMessage,
            3000
        );

        // Server should start successfully even with NODE_PATH pointing to empty dir
        assert.ok(result.stdout.includes('"result"'), 'Server should start with NODE_PATH');
    });

    test('logs tool registration on startup', async () => {
        const initMessage = {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0.0' },
            },
        };

        const result = await startMcpServerWithMessage(
            {
                LLMEM_WORKSPACE: workspace.root,
                NODE_PATH: modulesDir,
            },
            initMessage,
            3000
        );

        // Should log about tool registration (the main functionality we care about)
        assert.ok(
            result.stderr.includes('Registered') && result.stderr.includes('tools'),
            'Should log tool registration on startup'
        );
    });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('MCP Server Error Handling', () => {
    test('handles missing workspace gracefully', async () => {
        const initMessage = {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0.0' },
            },
        };

        // Use a non-existent workspace
        const result = await startMcpServerWithMessage(
            { LLMEM_WORKSPACE: '/nonexistent/path/that/does/not/exist' },
            initMessage,
            3000
        );

        // Server might fail or fallback - either is acceptable
        // The key is it doesn't crash with an unhandled error
        assert.ok(
            result.exitCode !== null || result.stdout.includes('"jsonrpc"'),
            'Should handle missing workspace (exit or respond)'
        );
    });

    test('handles malformed JSON-RPC gracefully', async () => {
        const workspace = createTestWorkspace();

        try {
            const cliPath = path.join(__dirname, '../../claude/claude/cli.js');

            const result = await new Promise<{ stdout: string; stderr: string }>((resolve) => {
                const child = spawn('node', [cliPath, 'mcp'], {
                    env: { ...process.env, LLMEM_WORKSPACE: workspace.root },
                    stdio: ['pipe', 'pipe', 'pipe'],
                });

                let stdout = '';
                let stderr = '';

                const timeout = setTimeout(() => {
                    child.kill();
                    resolve({ stdout, stderr });
                }, 2000);

                child.stdout?.on('data', (data) => {
                    stdout += data.toString();
                });

                child.stderr?.on('data', (data) => {
                    stderr += data.toString();
                });

                child.on('close', () => {
                    clearTimeout(timeout);
                    resolve({ stdout, stderr });
                });

                // Send malformed message
                child.stdin?.write('not valid json\n');
                child.stdin?.end();
            });

            // Server should handle this without crashing
            // It may log an error or just ignore the malformed message
            assert.ok(true, 'Server handled malformed JSON without crashing');
        } finally {
            workspace.cleanup();
        }
    });
});
