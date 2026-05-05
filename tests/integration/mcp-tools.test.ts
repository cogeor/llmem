/**
 * MCP Tools Integration Tests
 *
 * Tests the file_info and report_file_info tools end-to-end.
 * Uses a temporary workspace to avoid polluting the real project.
 */

import { strict as assert } from 'assert';
import { test, describe, before, after } from 'node:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Import the actual handlers (not the wrapped versions)
import {
    FileInfoSchema,
    ReportFileInfoSchema,
    FolderInfoSchema,
    ReportFolderInfoSchema,
    handleInspectSourceImpl,
} from '../../src/mcp/tools';

import { validateRequest, formatSuccess, formatError, formatPromptResponse } from '../../src/mcp/handlers';
import { setStoredWorkspaceRoot, setStoredConfig } from '../../src/mcp/server';
import { DEFAULT_CONFIG } from '../../src/config-defaults';

// ============================================================================
// Test Fixtures
// ============================================================================

interface TestWorkspace {
    root: string;
    cleanup: () => void;
}

/**
 * Create a temporary workspace with sample files for testing
 */
function createTestWorkspace(): TestWorkspace {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-test-'));

    // Create sample TypeScript file
    const srcDir = path.join(root, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    const sampleFile = path.join(srcDir, 'sample.ts');
    fs.writeFileSync(sampleFile, `
/**
 * Sample module for testing
 */

export function greet(name: string): string {
    return \`Hello, \${name}!\`;
}

export function add(a: number, b: number): number {
    return a + b;
}

export class Calculator {
    private value: number = 0;

    add(n: number): this {
        this.value += n;
        return this;
    }

    getResult(): number {
        return this.value;
    }
}
`.trim());

    // Create .arch directory
    const archDir = path.join(root, '.arch');
    fs.mkdirSync(archDir, { recursive: true });

    return {
        root,
        cleanup: () => {
            fs.rmSync(root, { recursive: true, force: true });
        },
    };
}

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe('MCP Tool Schema Validation', () => {
    test('FileInfoSchema validates correct input', () => {
        const result = validateRequest(FileInfoSchema, {
            workspaceRoot: '/home/user/project',
            path: 'src/sample.ts',
        });

        assert.equal(result.success, true);
        assert.equal(result.data?.workspaceRoot, '/home/user/project');
        assert.equal(result.data?.path, 'src/sample.ts');
    });

    test('FileInfoSchema rejects missing workspaceRoot', () => {
        const result = validateRequest(FileInfoSchema, {
            path: 'src/sample.ts',
        });

        assert.equal(result.success, false);
        assert.ok(result.error?.includes('workspaceRoot'));
    });

    test('FileInfoSchema rejects missing path', () => {
        const result = validateRequest(FileInfoSchema, {
            workspaceRoot: '/home/user/project',
        });

        assert.equal(result.success, false);
        assert.ok(result.error?.includes('path'));
    });

    test('ReportFileInfoSchema validates correct input', () => {
        const result = validateRequest(ReportFileInfoSchema, {
            workspaceRoot: '/home/user/project',
            path: 'src/sample.ts',
            overview: 'This file provides utility functions.',
            functions: [
                {
                    name: 'greet',
                    purpose: 'Returns a greeting message',
                    implementation: '- Takes name parameter\n- Returns formatted string',
                },
            ],
        });

        assert.equal(result.success, true);
        assert.equal(result.data?.overview, 'This file provides utility functions.');
        assert.equal(result.data?.functions.length, 1);
    });

    test('ReportFileInfoSchema allows optional inputs/outputs', () => {
        const result = validateRequest(ReportFileInfoSchema, {
            workspaceRoot: '/home/user/project',
            path: 'src/sample.ts',
            overview: 'Overview text',
            inputs: 'Takes configuration options',
            outputs: 'Returns processed data',
            functions: [],
        });

        assert.equal(result.success, true);
        assert.equal(result.data?.inputs, 'Takes configuration options');
        assert.equal(result.data?.outputs, 'Returns processed data');
    });

    test('FolderInfoSchema validates correct input', () => {
        const result = validateRequest(FolderInfoSchema, {
            workspaceRoot: '/home/user/project',
            path: 'src/utils',
        });

        assert.equal(result.success, true);
    });

    test('ReportFolderInfoSchema validates correct input', () => {
        const result = validateRequest(ReportFolderInfoSchema, {
            workspaceRoot: '/home/user/project',
            path: 'src/utils',
            overview: 'Utility functions for the project',
            key_files: [
                { name: 'helpers.ts', summary: 'Common helper functions' },
            ],
            architecture: 'Simple flat structure with exported utilities',
        });

        assert.equal(result.success, true);
        assert.equal(result.data?.key_files.length, 1);
    });
});

// ============================================================================
// Response Formatting Tests
// ============================================================================

describe('MCP Response Formatting', () => {
    test('formatSuccess creates correct structure', () => {
        const response = formatSuccess({ message: 'Done', count: 42 });

        assert.equal(response.status, 'success');
        assert.deepEqual(response.data, { message: 'Done', count: 42 });
        assert.equal(response.error, undefined);
    });

    test('formatError creates correct structure', () => {
        const response = formatError('Something went wrong');

        assert.equal(response.status, 'error');
        assert.equal(response.error, 'Something went wrong');
        assert.equal(response.data, undefined);
    });

    test('formatPromptResponse creates correct structure', () => {
        const response = formatPromptResponse(
            'Please analyze this code...',
            'report_file_info',
            { workspaceRoot: '/project', path: 'src/file.ts' }
        );

        assert.equal(response.status, 'prompt_ready');
        assert.equal(response.promptForHostLLM, 'Please analyze this code...');
        assert.equal(response.callbackTool, 'report_file_info');
        assert.deepEqual(response.callbackArgs, {
            workspaceRoot: '/project',
            path: 'src/file.ts',
        });
    });
});

// ============================================================================
// Integration Tests with Real Filesystem
// ============================================================================

describe('MCP Tools Integration', () => {
    let workspace: TestWorkspace;

    before(() => {
        workspace = createTestWorkspace();
        // Loop 04: MCP tools now read the server-side WorkspaceContext via
        // `getStoredContext()`, which requires both `storedWorkspaceRoot`
        // and `storedConfig` to be populated. Tests that call the handlers
        // directly (without booting a real MCP server) must set both.
        setStoredWorkspaceRoot(workspace.root);
        setStoredConfig({ ...DEFAULT_CONFIG });
    });

    after(() => {
        setStoredWorkspaceRoot(null);
        setStoredConfig(null);
        workspace.cleanup();
    });

    test('report_file_info creates design document in .arch/', async () => {
        // Import the handler
        const { handleReportFileInfo } = await import('../../src/mcp/tools');

        // Simulate what LLM would send after processing file_info prompt
        const response = await handleReportFileInfo({
            workspaceRoot: workspace.root,
            path: 'src/sample.ts',
            overview: 'Sample module providing greeting and math utilities.',
            inputs: 'String names and numeric values',
            outputs: 'Formatted strings and computed numbers',
            functions: [
                {
                    name: 'greet',
                    purpose: 'Returns a personalized greeting message',
                    implementation: '- Accepts a name string\n- Returns formatted greeting with template literal',
                },
                {
                    name: 'add',
                    purpose: 'Adds two numbers together',
                    implementation: '- Takes two numeric parameters\n- Returns their sum',
                },
            ],
        });

        // Check response
        assert.equal(response.status, 'success', `Expected success but got: ${response.error}`);
        assert.ok(response.data, 'Response should have data');

        // Check file was created
        const archFile = path.join(workspace.root, '.arch', 'src', 'sample.ts.md');
        assert.ok(fs.existsSync(archFile), `Expected file to exist: ${archFile}`);

        // Check content
        const content = fs.readFileSync(archFile, 'utf-8');
        assert.ok(content.includes('DESIGN DOCUMENT'), 'Should have design document header');
        assert.ok(content.includes('src/sample.ts'), 'Should reference the file path');
        assert.ok(content.includes('Sample module providing greeting'), 'Should include overview');
        assert.ok(content.includes('greet'), 'Should document greet function');
        assert.ok(content.includes('add'), 'Should document add function');
    });

    test('report_file_info: workspaceRoot wins over process.cwd() (L25 regression)', async () => {
        const { handleReportFileInfo } = await import('../../src/mcp/tools');

        // Use an isolated workspace + fake "AppData" to simulate the
        // legacy bug condition. A future refactor that constructs
        // WorkspaceIO from process.cwd() instead of the validated
        // workspaceRoot makes this test fail.
        const ws = createTestWorkspace();
        const fakeAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-fake-appdata-'));
        const originalCwd = process.cwd();

        // Pin the server's stored root + config so assertWorkspaceRootMatch
        // passes AND `getStoredContext` rebuilds against the new root.
        // setStoredWorkspaceRoot/Config also reset the memoized context.
        setStoredWorkspaceRoot(ws.root);
        setStoredConfig({ ...DEFAULT_CONFIG });
        process.chdir(fakeAppData);

        try {
            const response = await handleReportFileInfo({
                workspaceRoot: ws.root,
                path: 'src/sample.ts',
                overview: 'L25 regression overview',
                functions: [
                    { name: 'greet', purpose: 'greets', implementation: '- step 1' },
                ],
            });

            assert.equal(
                response.status,
                'success',
                `Expected success: ${JSON.stringify(response)}`,
            );
            assert.ok(response.data, 'Response should have data');

            // The artifact must land inside the workspace, not inside process.cwd().
            const wsResolved = fs.realpathSync(ws.root);
            const cwdResolved = fs.realpathSync(fakeAppData);
            const archResolved = fs.realpathSync(
                (response.data as { artifactPath: string }).artifactPath,
            );

            assert.ok(
                archResolved.startsWith(wsResolved),
                `archPath ${archResolved} must start with workspaceRoot ${wsResolved}`,
            );
            assert.ok(
                !archResolved.startsWith(cwdResolved),
                `archPath ${archResolved} must NOT start with fakeAppData ${cwdResolved}`,
            );

            // Concretely: <workspaceRoot>/.arch/src/sample.ts.md
            const expected = path.join(ws.root, '.arch', 'src', 'sample.ts.md');
            assert.equal(
                path.resolve((response.data as { artifactPath: string }).artifactPath),
                path.resolve(expected),
            );
        } finally {
            process.chdir(originalCwd);
            // Restore the describe-level workspace + config so subsequent
            // tests don't get a "workspace root not set" error.
            setStoredWorkspaceRoot(workspace.root);
            setStoredConfig({ ...DEFAULT_CONFIG });
            ws.cleanup();
            fs.rmSync(fakeAppData, { recursive: true, force: true });
        }
    });

    test('report_folder_info: workspaceRoot wins over process.cwd() (L25 regression)', async () => {
        const { handleReportFolderInfo } = await import('../../src/mcp/tools');

        // The writer (processFolderInfoReport) does NOT read .artifacts —
        // that's the prompt-builder's job. So no edge-list fixture is needed.
        const ws = createTestWorkspace();
        const fakeAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-fake-appdata-folder-'));
        const originalCwd = process.cwd();

        setStoredWorkspaceRoot(ws.root);
        setStoredConfig({ ...DEFAULT_CONFIG });
        process.chdir(fakeAppData);

        try {
            const response = await handleReportFolderInfo({
                workspaceRoot: ws.root,
                path: 'src',
                overview: 'L25 regression folder overview',
                key_files: [
                    { name: 'sample.ts', summary: 'Sample utilities' },
                ],
                architecture: 'Flat module layout.',
            });

            assert.equal(
                response.status,
                'success',
                `Expected success: ${JSON.stringify(response)}`,
            );
            assert.ok(response.data, 'Response should have data');

            const wsResolved = fs.realpathSync(ws.root);
            const cwdResolved = fs.realpathSync(fakeAppData);
            const readmeResolved = fs.realpathSync(
                (response.data as { artifactPath: string }).artifactPath,
            );

            assert.ok(
                readmeResolved.startsWith(wsResolved),
                `readmePath ${readmeResolved} must start with workspaceRoot ${wsResolved}`,
            );
            assert.ok(
                !readmeResolved.startsWith(cwdResolved),
                `readmePath ${readmeResolved} must NOT start with fakeAppData ${cwdResolved}`,
            );

            // Concretely: <workspaceRoot>/.arch/src/README.md
            const expected = path.join(ws.root, '.arch', 'src', 'README.md');
            assert.equal(
                path.resolve((response.data as { artifactPath: string }).artifactPath),
                path.resolve(expected),
            );
        } finally {
            process.chdir(originalCwd);
            // Restore the describe-level workspace + config so subsequent
            // tests don't get a "workspace root not set" error.
            setStoredWorkspaceRoot(workspace.root);
            setStoredConfig({ ...DEFAULT_CONFIG });
            ws.cleanup();
            fs.rmSync(fakeAppData, { recursive: true, force: true });
        }
    });

    test('report_folder_info creates README in .arch/<folder>/', async () => {
        const { handleReportFolderInfo } = await import('../../src/mcp/tools');

        const response = await handleReportFolderInfo({
            workspaceRoot: workspace.root,
            path: 'src',
            overview: 'Source directory containing all application code.',
            inputs: 'User configuration and external data',
            outputs: 'Compiled application artifacts',
            key_files: [
                { name: 'sample.ts', summary: 'Sample utilities for testing' },
            ],
            architecture: 'Flat structure with TypeScript modules.',
        });

        assert.equal(response.status, 'success', `Expected success but got: ${response.error}`);

        // Check file was created
        const readmeFile = path.join(workspace.root, '.arch', 'src', 'README.md');
        assert.ok(fs.existsSync(readmeFile), `Expected file to exist: ${readmeFile}`);

        // Check content
        const content = fs.readFileSync(readmeFile, 'utf-8');
        assert.ok(content.includes('FOLDER: src'), 'Should have folder header');
        assert.ok(content.includes('Source directory'), 'Should include overview');
        assert.ok(content.includes('sample.ts'), 'Should list key files');
    });

    test('file_info returns prompt_ready response', async () => {
        const { handleFileInfo } = await import('../../src/mcp/tools');

        const response = await handleFileInfo({
            workspaceRoot: workspace.root,
            path: 'src/sample.ts',
        });

        assert.equal(response.status, 'prompt_ready', `Expected prompt_ready but got: ${response.status}`);
        assert.ok(response.promptForHostLLM, 'Should have prompt for host LLM');
        assert.ok(response.promptForHostLLM.includes('sample.ts'), 'Prompt should reference the file');
        assert.equal(response.callbackTool, 'report_file_info', 'Should specify callback tool');
        assert.equal(response.callbackArgs?.path, 'src/sample.ts', 'Callback should include path');
    });

    test('handles non-existent file gracefully', async () => {
        const { handleFileInfo } = await import('../../src/mcp/tools');

        // Handler throws for non-existent files - this is expected behavior
        // The error is caught by the observer and logged
        try {
            await handleFileInfo({
                workspaceRoot: workspace.root,
                path: 'src/nonexistent.ts',
            });
            assert.fail('Should have thrown for non-existent file');
        } catch (error) {
            assert.ok(error instanceof Error);
            assert.ok(error.message.includes('not found') || error.message.includes('nonexistent'));
        }
    });

    test('rejects path traversal attempts', async () => {
        const { handleFileInfo } = await import('../../src/mcp/tools');

        // Handler throws for path traversal attempts
        try {
            await handleFileInfo({
                workspaceRoot: workspace.root,
                path: '../../../etc/passwd',
            });
            assert.fail('Should have thrown for path traversal');
        } catch (error) {
            assert.ok(error instanceof Error);
            assert.ok(
                error.message.toLowerCase().includes('outside') ||
                error.message.toLowerCase().includes('escapes') ||
                error.message.toLowerCase().includes('traversal'),
                `Error should mention path issue: ${error.message}`
            );
        }
    });
});

// ============================================================================
// End-to-End Workflow Test
// ============================================================================

describe('MCP End-to-End Workflow', () => {
    let workspace: TestWorkspace;

    before(() => {
        workspace = createTestWorkspace();
        // Loop 04: tools route through getStoredContext, which needs both
        // stored root and stored config to be set.
        setStoredWorkspaceRoot(workspace.root);
        setStoredConfig({ ...DEFAULT_CONFIG });
    });

    after(() => {
        setStoredWorkspaceRoot(null);
        setStoredConfig(null);
        workspace.cleanup();
    });

    test('full workflow: file_info → report_file_info → verify', async () => {
        const { handleFileInfo, handleReportFileInfo } = await import('../../src/mcp/tools');

        // Step 1: Call file_info to get prompt
        const infoResponse = await handleFileInfo({
            workspaceRoot: workspace.root,
            path: 'src/sample.ts',
        });

        assert.equal(infoResponse.status, 'prompt_ready');
        assert.ok(infoResponse.promptForHostLLM);

        // Step 2: Simulate LLM processing and call report_file_info
        // (In real usage, the LLM would analyze the prompt and generate this)
        const reportResponse = await handleReportFileInfo({
            workspaceRoot: workspace.root,
            path: 'src/sample.ts',
            overview: 'A sample TypeScript module demonstrating basic utilities.',
            functions: [
                {
                    name: 'greet',
                    purpose: 'Generate a greeting message',
                    implementation: '- Uses template literal\n- Returns formatted string',
                },
                {
                    name: 'add',
                    purpose: 'Sum two numbers',
                    implementation: '- Simple addition\n- Returns number type',
                },
            ],
        });

        assert.equal(reportResponse.status, 'success');

        // Step 3: Verify the generated documentation
        const docPath = path.join(workspace.root, '.arch', 'src', 'sample.ts.md');
        assert.ok(fs.existsSync(docPath), 'Design document should exist');

        const content = fs.readFileSync(docPath, 'utf-8');

        // Verify structure
        assert.ok(content.includes('# DESIGN DOCUMENT'), 'Should have header');
        assert.ok(content.includes('## FILE OVERVIEW'), 'Should have overview section');
        assert.ok(content.includes('## FUNCTION SPECIFICATIONS'), 'Should have functions section');

        // Verify content
        assert.ok(content.includes('greet'), 'Should document greet');
        assert.ok(content.includes('add'), 'Should document add');
        assert.ok(content.includes('sample TypeScript module'), 'Should include overview text');
    });
});

// ============================================================================
// inspect_source Tests
// ============================================================================

describe('inspect_source handler', () => {
    let workspace: TestWorkspace;
    const SAMPLE_LINES = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n');

    before(() => {
        workspace = createTestWorkspace();
        // Write a predictable file for line-range tests
        fs.writeFileSync(path.join(workspace.root, 'src', 'lines.txt'), SAMPLE_LINES);
        // Set the stored workspace root so handleInspectSourceImpl can resolve paths
        setStoredWorkspaceRoot(workspace.root);
    });

    after(() => {
        setStoredWorkspaceRoot(null);
        workspace.cleanup();
    });

    test('valid line range returns correct lines', async () => {
        const result = await handleInspectSourceImpl({
            path: 'src/lines.txt',
            startLine: 2,
            endLine: 4,
        });

        assert.equal(result.status, 'success', `Expected success but got: ${result.error}`);
        const snippet = result.data as string;
        assert.ok(snippet.includes('line2'), 'Should include line2');
        assert.ok(snippet.includes('line3'), 'Should include line3');
        assert.ok(snippet.includes('line4'), 'Should include line4');
        assert.ok(!snippet.includes('line1'), 'Should not include line1');
        assert.ok(!snippet.includes('line5'), 'Should not include line5');
    });

    test('line range too large (>500) returns error', async () => {
        // Write a file with enough lines to test the limit
        const bigContent = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n');
        fs.writeFileSync(path.join(workspace.root, 'src', 'big.txt'), bigContent);

        const result = await handleInspectSourceImpl({
            path: 'src/big.txt',
            startLine: 1,
            endLine: 502, // Exceeds INSPECT_SOURCE_MAX_LINES (500)
        });

        assert.equal(result.status, 'error', 'Should return error for oversized range');
        assert.ok(
            result.error?.includes('too large') || result.error?.includes('maximum'),
            `Error should mention size limit: ${result.error}`
        );
    });

    test('missing file returns error', async () => {
        const result = await handleInspectSourceImpl({
            path: 'src/does-not-exist.ts',
            startLine: 1,
            endLine: 5,
        });

        assert.equal(result.status, 'error', 'Should return error for missing file');
        assert.ok(
            result.error?.includes('not found') || result.error?.includes('does-not-exist'),
            `Error should mention file: ${result.error}`
        );
    });
});
