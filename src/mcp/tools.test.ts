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
} from './tools';

import { validateRequest, formatSuccess, formatError, formatPromptResponse } from './handlers';

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
    });

    after(() => {
        workspace.cleanup();
    });

    test('report_file_info creates design document in .arch/', async () => {
        // Import the handler
        const { handleReportFileInfo } = await import('./tools');

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

    test('report_folder_info creates README in .arch/<folder>/', async () => {
        const { handleReportFolderInfo } = await import('./tools');

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
        const { handleFileInfo } = await import('./tools');

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
        const { handleFileInfo } = await import('./tools');

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
        const { handleFileInfo } = await import('./tools');

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
    });

    after(() => {
        workspace.cleanup();
    });

    test('full workflow: file_info → report_file_info → verify', async () => {
        const { handleFileInfo, handleReportFileInfo } = await import('./tools');

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
