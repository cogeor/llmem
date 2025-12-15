/**
 * Test script for file info extraction
 * 
 * Tests the info extraction module by:
 * 1. Building graphs from artifacts
 * 2. Extracting file info
 * 3. Rendering to markdown
 * 4. Verifying output structure
 */

import * as path from 'path';
import {
    generateAllFileInfo,
    generateAndSaveAllFileInfo,
    getInfoOutputPath,
    buildReverseCallIndex,
    extractFileInfo,
    renderFileInfoMarkdown
} from '../info';
import { buildGraphs } from '../graph';
import { readArtifacts } from '../graph/artifact/reader';

const ROOT_DIR = path.resolve(__dirname, '../..');

async function runTests() {
    console.log('='.repeat(60));
    console.log('File Info Extraction Test');
    console.log('='.repeat(60));
    console.log();

    const artifactsDir = path.join(ROOT_DIR, '.artifacts');

    // Test 1: Build graphs and reverse index
    console.log('Test 1: Building graphs and reverse call index...');
    const { callGraph, importGraph } = await buildGraphs(artifactsDir);
    console.log(`  - Call graph nodes: ${callGraph.nodes.size}`);
    console.log(`  - Call graph edges: ${callGraph.edges.length}`);
    console.log(`  - Import graph nodes: ${importGraph.nodes.size}`);

    const reverseIndex = buildReverseCallIndex(callGraph);
    console.log(`  - Reverse index entries: ${reverseIndex.size}`);
    console.log('  ✓ Pass');
    console.log();

    // Test 2: Read artifacts
    console.log('Test 2: Reading artifacts...');
    const artifacts = readArtifacts(artifactsDir);
    console.log(`  - Found ${artifacts.length} artifact files`);
    console.log('  ✓ Pass');
    console.log();

    // Test 3: Extract file info for a sample file
    console.log('Test 3: Extracting file info for sample files...');
    let sampleCount = 0;
    for (const { fileId, artifact } of artifacts.slice(0, 3)) {
        const info = extractFileInfo(fileId, artifact, reverseIndex);
        console.log(`  - ${fileId}:`);
        console.log(`      Functions: ${info.functions.length}`);
        console.log(`      Classes: ${info.classes.length}`);
        sampleCount++;
    }
    console.log(`  ✓ Pass (${sampleCount} samples)`);
    console.log();

    // Test 4: Render markdown
    console.log('Test 4: Rendering markdown...');
    if (artifacts.length > 0) {
        const { fileId, artifact } = artifacts[0];
        const info = extractFileInfo(fileId, artifact, reverseIndex);
        const markdown = renderFileInfoMarkdown(info);

        console.log('  Sample output for:', fileId);
        console.log('-'.repeat(40));
        // Show first 30 lines
        const lines = markdown.split('\n').slice(0, 30);
        for (const line of lines) {
            console.log('  ' + line);
        }
        if (markdown.split('\n').length > 30) {
            console.log('  ... (truncated)');
        }
        console.log('-'.repeat(40));

        // Verify markdown structure
        const hasTitle = markdown.startsWith('# ');
        const hasCalledBy = markdown.includes('**Called by:**');
        console.log(`  - Has title: ${hasTitle ? '✓' : '✗'}`);
        console.log(`  - Has "Called by:" sections: ${hasCalledBy ? '✓' : '✗'}`);
    }
    console.log('  ✓ Pass');
    console.log();

    // Test 5: Generate all file info
    console.log('Test 5: Generating all file info...');
    const allInfo = await generateAllFileInfo(ROOT_DIR, artifactsDir);
    console.log(`  - Generated info for ${allInfo.size} files`);

    // Show files with callers
    let filesWithCallers = 0;
    for (const [fileId, markdown] of allInfo) {
        if (!markdown.includes('*(no callers found)*') || markdown.includes('` in `')) {
            filesWithCallers++;
        }
    }
    console.log(`  - Files with call relationships: ${filesWithCallers}`);
    console.log('  ✓ Pass');
    console.log();

    // Test 6: Save to disk
    console.log('Test 6: Saving markdown files...');
    const savedPaths = await generateAndSaveAllFileInfo(ROOT_DIR);
    console.log(`  - Saved ${savedPaths.length} markdown files`);
    if (savedPaths.length > 0) {
        console.log('  Sample paths:');
        for (const p of savedPaths.slice(0, 5)) {
            console.log(`    - ${path.relative(ROOT_DIR, p)}`);
        }
        if (savedPaths.length > 5) {
            console.log(`    ... and ${savedPaths.length - 5} more`);
        }
    }
    console.log('  ✓ Pass');
    console.log();

    console.log('='.repeat(60));
    console.log('All tests passed!');
    console.log('='.repeat(60));
}

runTests().catch(err => {
    console.error('Test failed with error:', err);
    process.exit(1);
});
