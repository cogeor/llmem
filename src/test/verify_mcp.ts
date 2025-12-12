import { initializeArtifactService } from '../artifact/service';
import { handleGetArtifacts, handleStoreFolderSummary, handleStoreSummaries } from '../mcp/tools';
import * as path from 'path';
import * as fs from 'fs/promises';

async function main() {
    const root = process.cwd();
    console.log(`Checking root: ${root}`);

    // Initialize service
    await initializeArtifactService(root);
    console.log('Artifact Service Initialized');

    // Mocks
    const rootFolder = 'src';
    const subFolder = 'src/extension';

    // 1. Get Artifacts RECURSIVELY
    console.log(`Requesting artifacts for folder: ${rootFolder} (RECURSIVE)`);
    const response = await handleGetArtifacts({ path: rootFolder, recursive: true });

    if (response.status !== 'prompt_ready') {
        console.error('MCP Request failed OR wrong status:', response.status, response.error);
        process.exit(1);
    }

    // Validate Prompt Structure
    const prompt = response.promptForHostLLM || '';
    if (!prompt.includes('store_summaries')) {
        console.error('Prompt did not ask to trigger store_summaries');
        process.exit(1);
    }
    if (!prompt.includes('grouped by folder')) {
        console.error('Prompt did not mention grouped context');
        process.exit(1);
    }

    console.log('MCP get_artifacts success! Prompt looks correct.');
    console.log('Prompt preview:', prompt.substring(0, 200) + '...');

    // 2. Simulate Host LLM generating recursive summaries
    console.log('Simulating Host LLM summary generation for multiple folders...');

    const fakeSummaries = {
        'src': '# SRC Root\nMain entry point',
        'src/extension': '# Extension\nVS Code extension logic',
        'src/mcp': '# MCP\nModel Context Protocol implementation'
    };

    const storeResponse = await handleStoreSummaries({
        summaries: fakeSummaries
    });

    if (storeResponse.status !== 'success') {
        console.error('MCP store_summaries failed:', storeResponse.error);
        process.exit(1);
    }
    console.log('MCP store_summaries success!');

    // 3. Verify files
    for (const [folder, content] of Object.entries(fakeSummaries)) {
        // e.g. .artifacts/src/src.summary or .artifacts/src/extension/extension.summary
        // Wait, path-mapper basename logic:
        // src -> src.summary
        // src/extension -> extension.summary

        const folderName = path.basename(folder);
        const summaryPath = path.join(root, '.artifacts', folder, `${folderName}.summary`);

        try {
            const fileContent = await fs.readFile(summaryPath, 'utf-8');
            if (fileContent === content) {
                console.log(`Verified summary for ${folder} at ${summaryPath}`);
            } else {
                console.error(`Content mismatch for ${folder}`);
                process.exit(1);
            }
        } catch (e) {
            console.error(`Missing summary file for ${folder} at ${summaryPath}`);
            console.error(e);
            process.exit(1);
        }
    }

    console.log('All Recursive Verifications PASSED');
}

main().catch(console.error);
