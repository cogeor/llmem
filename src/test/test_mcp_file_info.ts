/**
 * Test script for MCP file_info tool
 * 
 * Tests the refactored MCP with file_info and report_file_info tools.
 */

import * as path from 'path';
import { initializeArtifactService } from '../artifact/service';
import { handleFileInfo, handleReportFileInfo } from '../mcp/tools';

import * as fs from 'fs';

const ROOT_DIR = path.resolve(__dirname, '../..');

async function runTests() {
    console.log('='.repeat(60));
    console.log('MCP file_info Tool Test');
    console.log('='.repeat(60));
    console.log();

    // Setup: Create mock artifact for CI environment
    // The test expects an artifact for 'src/info/index.ts'
    const artifactDir = path.join(ROOT_DIR, '.artifacts', 'src', 'info');
    const mockArtifactPath = path.join(artifactDir, 'index.ts.artifact');

    console.log(`Ensuring mock artifact exists at: ${mockArtifactPath}`);
    if (!fs.existsSync(artifactDir)) {
        fs.mkdirSync(artifactDir, { recursive: true });
    }

    // Always overwrite to ensure valid state
    const mockArtifact = {
        file: {
            path: "src/info/index.ts",
            classes: [],
            functions: [],
            exports: []
        },
        imports: [],
        exports: []
    };
    fs.writeFileSync(mockArtifactPath, JSON.stringify(mockArtifact, null, 2));


    // Initialize
    console.log('Initializing artifact service...');
    await initializeArtifactService(ROOT_DIR);
    console.log('  ✓ Initialized');
    console.log();

    // Test 1: Call file_info
    console.log('Test 1: handleFileInfo()');
    const fileInfoResult = await handleFileInfo({ path: 'src/info/index.ts' });

    console.log(`  Status: ${fileInfoResult.status}`);

    if (fileInfoResult.status === 'prompt_ready') {
        console.log('  ✓ Returns prompt_ready');
        console.log(`  Callback tool: ${fileInfoResult.callbackTool}`);

        // Show first 500 chars of prompt
        const prompt = fileInfoResult.promptForHostLLM || '';
        console.log('  Prompt preview:');
        console.log('-'.repeat(40));
        console.log(prompt.slice(0, 500) + '...');
        console.log('-'.repeat(40));
    } else if (fileInfoResult.status === 'error') {
        console.log(`  ✗ Error: ${fileInfoResult.error}`);
        process.exit(1);
    }
    console.log();

    // Test 2: Simulate LLM response with report_file_info
    console.log('Test 2: handleReportFileInfo() - Simulated LLM response');

    const simulatedEnrichment = {
        path: 'src/info/index.ts',
        overview: 'This file is the main entry point for the info module. It re-exports types and functions for generating file documentation.',
        inputs: 'Workspace root directory, file paths',
        outputs: 'Markdown documentation strings, saved .md files',
        functions: [
            {
                name: 'generateSingleFileInfo',
                purpose: 'Generates markdown documentation for a single source file.',
                implementation: '1. Extracts file info from artifact\n2. Looks up callers from reverse index\n3. Renders to markdown format'
            },
            {
                name: 'generateAllFileInfo',
                purpose: 'Generates documentation for all files in the workspace.',
                implementation: '1. Builds call graph from artifacts\n2. Creates reverse call index\n3. Iterates all artifacts\n4. Returns map of file paths to markdown'
            }
        ]
    };

    const reportResult = await handleReportFileInfo(simulatedEnrichment);

    console.log(`  Status: ${reportResult.status}`);

    if (reportResult.status === 'success') {
        console.log('  ✓ Enriched documentation saved');
        console.log(`  Data: ${JSON.stringify(reportResult.data)}`);
    } else if (reportResult.status === 'error') {
        console.log(`  ✗ Error: ${reportResult.error}`);
    }
    console.log();

    console.log('='.repeat(60));
    console.log('All tests completed!');
    console.log('='.repeat(60));
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
