import { initializeArtifactService } from '../artifact/service';
import { handleGetArtifacts, handleStoreFolderSummary } from '../mcp/tools';
import * as path from 'path';
import * as fs from 'fs/promises';

async function main() {
    const root = process.cwd();
    console.log(`Checking root: ${root}`);

    // Initialize service
    await initializeArtifactService(root);
    console.log('Artifact Service Initialized');

    // Mocks
    const testFolder = 'src/extension';
    const testFile = 'config.ts';

    // Clean up
    const artifactPath = path.join(root, '.artifacts', testFolder, 'config.ts.artifact');
    const summaryPath = path.join(root, '.artifacts', testFolder, 'extension.summary');
    try {
        await fs.unlink(artifactPath);
        await fs.unlink(summaryPath);
        console.log('Cleaned up previous artifacts');
    } catch {
        // ignore
    }

    console.log(`Requesting artifacts for folder: ${testFolder}`);
    // 1. Get Artifacts
    const response = await handleGetArtifacts({ path: testFolder });

    if (response.status !== 'prompt_ready') {
        console.error('MCP Request failed OR wrong status:', response.status, response.error);
        process.exit(1);
    }

    console.log('MCP get_artifacts success! Status: prompt_ready');
    console.log('Prompt preview:', response.promptForHostLLM?.substring(0, 100) + '...');

    // Verify file creation (config.ts.artifact)
    try {
        const stats = await fs.stat(artifactPath);
        console.log(`File Artifact created at ${artifactPath} (Size: ${stats.size})`);
    } catch (e) {
        console.error(`Verification FAILED: Artifact file not found at ${artifactPath}`);
        process.exit(1);
    }

    // 2. Store Summary
    console.log('Simulating Host LLM summary generation...');
    const fakeSummary = '# Module Summary\n\nThis module handles VS Code extension configuration.';
    const storeResponse = await handleStoreFolderSummary({
        path: testFolder,
        summary: fakeSummary
    });

    if (storeResponse.status !== 'success') {
        console.error('MCP store_folder_summary failed:', storeResponse.error);
        process.exit(1);
    }
    console.log('MCP store_folder_summary success!');

    // Verify summary creation
    try {
        const stats = await fs.stat(summaryPath);
        console.log(`Folder Summary created at ${summaryPath} (Size: ${stats.size})`);
        const content = await fs.readFile(summaryPath, 'utf-8');
        if (content === fakeSummary) {
            console.log('Verification PASSED: Summary content matches.');
        } else {
            console.error('Verification FAILED: Summary content mismatch.');
            process.exit(1);
        }
    } catch (e) {
        // It might be named extension.summary or src.summary depending on how basename works on src/extension
        // path.basename('src/extension') is 'extension'. 
        // summaryFilePath uses relative path.
        console.error(`Verification FAILED: Summary file not found at ${summaryPath}`);
        console.error(e);
        process.exit(1);
    }
}

main().catch(console.error);
