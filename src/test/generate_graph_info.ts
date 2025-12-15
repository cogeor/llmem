/**
 * Test script to generate file info for src/graph folder
 * 
 * Generates enriched documentation for all files in src/graph
 */

import * as path from 'path';
import { initializeArtifactService } from '../artifact/service';
import { handleFileInfo, handleReportFileInfo } from '../mcp/tools';
import { readArtifacts } from '../graph/artifact/reader';

const ROOT_DIR = path.resolve(__dirname, '../..');

// Simulated LLM enrichment data (you would get this from actual LLM)
function simulateLLMEnrichment(filePath: string): any {
    return {
        path: filePath,
        overview: `Module for ${path.basename(filePath, '.ts')} functionality.`,
        inputs: 'Artifacts from .artifacts directory',
        outputs: 'Graph data structures',
        functions: []  // LLM would fill this
    };
}

async function main() {
    console.log('='.repeat(60));
    console.log('Generate File Info for src/graph');
    console.log('='.repeat(60));
    console.log();

    // Initialize
    await initializeArtifactService(ROOT_DIR);

    // Find all files in src/graph
    const artifactsDir = path.join(ROOT_DIR, '.artifacts');
    const allArtifacts = readArtifacts(artifactsDir);

    const graphFiles = allArtifacts.filter(a =>
        a.fileId.startsWith('src/graph') || a.fileId.startsWith('src\\graph')
    );

    console.log(`Found ${graphFiles.length} files in src/graph:`);
    for (const { fileId } of graphFiles) {
        console.log(`  - ${fileId}`);
    }
    console.log();

    // Process each file
    for (const { fileId } of graphFiles) {
        console.log(`Processing: ${fileId}`);

        // Step 1: Call file_info to get structural data
        const infoResult = await handleFileInfo({ path: fileId });

        if (infoResult.status === 'error') {
            console.log(`  ✗ Error: ${infoResult.error}`);
            continue;
        }

        // Step 2: Simulate LLM enrichment (in real usage, LLM does this)
        const enrichment = simulateLLMEnrichment(fileId);

        // Step 3: Save enriched data
        const saveResult = await handleReportFileInfo(enrichment);

        if (saveResult.status === 'success') {
            console.log(`  ✓ Saved to: ${(saveResult.data as any)?.path}`);
        } else {
            console.log(`  ✗ Save error: ${saveResult.error}`);
        }
    }

    console.log();
    console.log('='.repeat(60));
    console.log('Done!');
    console.log('='.repeat(60));
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
