/**
 * MCP Tools Integration Tests
 *
 * Tests the merged `document` / `report_document` pair end-to-end (C5:
 * formerly file_info/folder_info + report_file_info/report_folder_info).
 * Uses a temporary workspace to avoid polluting the real project.
 */

import { strict as assert } from 'assert';
import { test, describe, before, after } from 'node:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { DocumentSchema, ReportDocumentSchema } from '../../src/mcp/tools';

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

    // Create docs directory
    const docsDir = path.join(root, '.llmem', 'docs');
    fs.mkdirSync(docsDir, { recursive: true });

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
    test('DocumentSchema validates correct input (file or folder path — same shape)', () => {
        const result = validateRequest(DocumentSchema, {
            workspaceRoot: '/home/user/project',
            path: 'src/sample.ts',
        });

        assert.equal(result.success, true);
        assert.equal(result.data?.workspaceRoot, '/home/user/project');
        assert.equal(result.data?.path, 'src/sample.ts');
        assert.equal(result.data?.refresh, 'auto');
    });

    test('DocumentSchema rejects missing workspaceRoot', () => {
        const result = validateRequest(DocumentSchema, {
            path: 'src/sample.ts',
        });

        assert.equal(result.success, false);
        assert.ok(result.error?.includes('workspaceRoot'));
    });

    test('DocumentSchema rejects missing path', () => {
        const result = validateRequest(DocumentSchema, {
            workspaceRoot: '/home/user/project',
        });

        assert.equal(result.success, false);
        assert.ok(result.error?.includes('path'));
    });

    test('ReportDocumentSchema validates a kind:file payload', () => {
        const result = validateRequest(ReportDocumentSchema, {
            kind: 'file',
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

        assert.equal(result.success, true, result.error);
        assert.equal(result.data?.overview, 'This file provides utility functions.');
        assert.equal(result.data?.kind, 'file');
    });

    test('ReportDocumentSchema validates a kind:folder payload', () => {
        const result = validateRequest(ReportDocumentSchema, {
            kind: 'folder',
            workspaceRoot: '/home/user/project',
            path: 'src/utils',
            overview: 'Utility functions for the project',
            key_files: [
                { name: 'helpers.ts', summary: 'Common helper functions' },
            ],
            architecture: 'Simple flat structure with exported utilities',
        });

        assert.equal(result.success, true, result.error);
        assert.equal(result.data?.kind, 'folder');
    });

    test('ReportDocumentSchema rejects a payload without kind', () => {
        const result = validateRequest(ReportDocumentSchema, {
            workspaceRoot: '/home/user/project',
            path: 'src/sample.ts',
            overview: 'x',
            functions: [],
        });

        assert.equal(result.success, false);
    });

    test('ReportDocumentSchema rejects a kind:folder payload with file-only fields', () => {
        // Folder variant requires `architecture`; a file body under
        // kind:'folder' must not validate.
        const result = validateRequest(ReportDocumentSchema, {
            kind: 'folder',
            workspaceRoot: '/home/user/project',
            path: 'src/utils',
            overview: 'x',
            functions: [],
        });

        assert.equal(result.success, false);
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
            'report_document',
            { workspaceRoot: '/project', path: 'src/file.ts', kind: 'file' }
        );

        assert.equal(response.status, 'prompt_ready');
        assert.equal(response.promptForHostLLM, 'Please analyze this code...');
        assert.equal(response.callbackTool, 'report_document');
        assert.deepEqual(response.callbackArgs, {
            workspaceRoot: '/project',
            path: 'src/file.ts',
            kind: 'file',
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

    test('report_document (kind:file) creates design document in .llmem/docs/', async () => {
        const { handleReportDocument } = await import('../../src/mcp/tools');

        // Simulate what LLM would send after processing the document prompt
        const response = await handleReportDocument({
            kind: 'file',
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
        const docFile = path.join(workspace.root, '.llmem', 'docs', 'src', 'sample.ts.md');
        assert.ok(fs.existsSync(docFile), `Expected file to exist: ${docFile}`);

        // Check content
        const content = fs.readFileSync(docFile, 'utf-8');
        assert.ok(content.includes('DESIGN DOCUMENT'), 'Should have design document header');
        assert.ok(content.includes('src/sample.ts'), 'Should reference the file path');
        assert.ok(content.includes('Sample module providing greeting'), 'Should include overview');
        assert.ok(content.includes('greet'), 'Should document greet function');
        assert.ok(content.includes('add'), 'Should document add function');
    });

    test('report_document: workspaceRoot wins over process.cwd() (L25 regression, file)', async () => {
        const { handleReportDocument } = await import('../../src/mcp/tools');

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
            const response = await handleReportDocument({
                kind: 'file',
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
            const docResolved = fs.realpathSync(
                (response.data as { artifactPath: string }).artifactPath,
            );

            assert.ok(
                docResolved.startsWith(wsResolved),
                `docPath ${docResolved} must start with workspaceRoot ${wsResolved}`,
            );
            assert.ok(
                !docResolved.startsWith(cwdResolved),
                `docPath ${docResolved} must NOT start with fakeAppData ${cwdResolved}`,
            );

            // Concretely: <workspaceRoot>/.llmem/docs/src/sample.ts.md
            const expected = path.join(ws.root, '.llmem', 'docs', 'src', 'sample.ts.md');
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

    test('report_document: workspaceRoot wins over process.cwd() (L25 regression, folder)', async () => {
        const { handleReportDocument } = await import('../../src/mcp/tools');

        // The writer (processFolderInfoReport) does NOT read .artifacts —
        // that's the prompt-builder's job. So no edge-list fixture is needed.
        const ws = createTestWorkspace();
        const fakeAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-fake-appdata-folder-'));
        const originalCwd = process.cwd();

        setStoredWorkspaceRoot(ws.root);
        setStoredConfig({ ...DEFAULT_CONFIG });
        process.chdir(fakeAppData);

        try {
            const response = await handleReportDocument({
                kind: 'folder',
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

            // Concretely: <workspaceRoot>/.llmem/docs/src/README.md
            const expected = path.join(ws.root, '.llmem', 'docs', 'src', 'README.md');
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

    test('report_document (kind:folder) creates README in .llmem/docs/<folder>/', async () => {
        const { handleReportDocument } = await import('../../src/mcp/tools');

        const response = await handleReportDocument({
            kind: 'folder',
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
        const readmeFile = path.join(workspace.root, '.llmem', 'docs', 'src', 'README.md');
        assert.ok(fs.existsSync(readmeFile), `Expected file to exist: ${readmeFile}`);

        // Check content
        const content = fs.readFileSync(readmeFile, 'utf-8');
        assert.ok(content.includes('FOLDER: src'), 'Should have folder header');
        assert.ok(content.includes('Source directory'), 'Should include overview');
        assert.ok(content.includes('sample.ts'), 'Should list key files');
    });

    test('report_document rejects a kind that contradicts the path', async () => {
        const { handleReportDocument } = await import('../../src/mcp/tools');

        // src/sample.ts is a FILE; a folder payload for it must be rejected
        // (it would otherwise write .llmem/docs/src/sample.ts/README.md).
        const response = await handleReportDocument({
            kind: 'folder',
            workspaceRoot: workspace.root,
            path: 'src/sample.ts',
            overview: 'mis-kinded payload',
            key_files: [],
            architecture: 'n/a',
        });

        assert.equal(response.status, 'error', 'kind mismatch must be an error');
        assert.ok(
            (response.error ?? '').includes('is a file'),
            `error names the actual kind; got: ${response.error}`,
        );
    });

    test('document (file path) returns prompt_ready with kind:file callback', async () => {
        const { handleDocument } = await import('../../src/mcp/tools');

        const response = await handleDocument({
            workspaceRoot: workspace.root,
            path: 'src/sample.ts',
        });

        assert.equal(response.status, 'prompt_ready', `Expected prompt_ready but got: ${response.status}`);
        assert.ok(response.promptForHostLLM, 'Should have prompt for host LLM');
        assert.ok(response.promptForHostLLM.includes('sample.ts'), 'Prompt should reference the file');
        assert.equal(response.callbackTool, 'report_document', 'Should specify callback tool');
        assert.equal(response.callbackArgs?.path, 'src/sample.ts', 'Callback should include path');
        assert.equal(response.callbackArgs?.kind, 'file', 'Callback should carry the detected kind');
    });

    test('handles non-existent file gracefully', async () => {
        const { handleDocument } = await import('../../src/mcp/tools');

        const response = await handleDocument({
            workspaceRoot: workspace.root,
            path: 'src/nonexistent.ts',
        });

        // The merged tool stats the path up-front, so a missing path is a
        // formatted error response (not a thrown crash).
        assert.equal(response.status, 'error');
        assert.ok(
            (response.error ?? '').includes('not found'),
            `error mentions the missing path: ${response.error}`,
        );
    });

    test('rejects path traversal attempts', async () => {
        const { handleDocument } = await import('../../src/mcp/tools');

        // Handler throws for path traversal attempts
        try {
            await handleDocument({
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

    test('full workflow: document → report_document → verify', async () => {
        const { handleDocument, handleReportDocument } = await import('../../src/mcp/tools');

        // Step 1: Call document to get prompt (+ detected kind)
        const infoResponse = await handleDocument({
            workspaceRoot: workspace.root,
            path: 'src/sample.ts',
        });

        assert.equal(infoResponse.status, 'prompt_ready');
        assert.ok(infoResponse.promptForHostLLM);
        assert.equal(infoResponse.callbackArgs?.kind, 'file');

        // Step 2: Simulate LLM processing and call report_document with the
        // callback args (in real usage, the LLM would generate the body).
        const reportResponse = await handleReportDocument({
            ...infoResponse.callbackArgs,
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
        const docPath = path.join(workspace.root, '.llmem', 'docs', 'src', 'sample.ts.md');
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
