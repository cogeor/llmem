#!/usr/bin/env npx ts-node
/**
 * Manual Edge List Generation Script
 * 
 * Run: npx ts-node src/scripts/generate_edgelist.ts
 * 
 * This script generates the split edge lists without going through the panel.
 * Used to verify edge list generation works correctly.
 */

import * as path from 'path';
import * as fs from 'fs';
import { ImportEdgeListStore, CallEdgeListStore } from '../graph/edgelist';
import { TypeScriptService } from '../parser/ts-service';
import { TypeScriptExtractor } from '../parser/ts-extractor';
import { artifactToEdgeList } from '../graph/artifact-converter';

async function main() {
    console.log('='.repeat(60));
    console.log('MANUAL EDGE LIST GENERATION (SPLIT STORES)');
    console.log('='.repeat(60));

    const root = process.cwd();
    const artifactDir = path.join(root, '.artifacts');

    console.log(`\nProject root: ${root}`);
    console.log(`Output dir: ${artifactDir}`);

    // Ensure artifact directory exists
    if (!fs.existsSync(artifactDir)) {
        console.log(`\nCreating ${artifactDir}...`);
        fs.mkdirSync(artifactDir, { recursive: true });
    }

    // Initialize TypeScript service
    console.log('\nInitializing TypeScript service...');
    const tsService = new TypeScriptService(root);
    const tsExtractor = new TypeScriptExtractor(() => tsService.getProgram(), root);

    const program = tsService.getProgram();
    if (!program) {
        console.error('ERROR: Failed to create TypeScript program');
        process.exit(1);
    }

    // Normalize root for path comparison
    const normalizedRoot = root.replace(/\\/g, '/');

    // Get source files
    const sourceFiles = program.getSourceFiles().filter(sf => {
        const filePath = sf.fileName.replace(/\\/g, '/');
        return !filePath.includes('node_modules') &&
            !filePath.endsWith('.d.ts') &&
            filePath.startsWith(normalizedRoot);
    });

    console.log(`\nFound ${sourceFiles.length} TypeScript files to process`);

    // Create split edge list stores
    const importStore = new ImportEdgeListStore(artifactDir);
    const callStore = new CallEdgeListStore(artifactDir);
    importStore.clear(); // Start fresh
    callStore.clear();

    // Process each file
    let processed = 0;
    let errors = 0;

    for (const sf of sourceFiles) {
        const filePath = sf.fileName;
        const relativePath = path.relative(root, filePath).replace(/\\/g, '/');

        try {
            const artifact = await tsExtractor.extract(filePath);
            if (!artifact) {
                console.log(`  SKIP: ${relativePath} (no artifact returned)`);
                continue;
            }

            const { nodes, importEdges, callEdges } = artifactToEdgeList(artifact, relativePath);

            // Add nodes to both stores
            importStore.addNodes(nodes);
            callStore.addNodes(nodes);

            // Add edges to respective stores
            importStore.addEdges(importEdges);
            callStore.addEdges(callEdges);

            processed++;

            if (processed % 20 === 0) {
                console.log(`  Processed ${processed} files...`);
            }
        } catch (e: any) {
            console.error(`  ERROR: ${relativePath}: ${e.message}`);
            errors++;
        }
    }

    // Save
    console.log('\nSaving edge lists...');
    await importStore.save();
    await callStore.save();

    // Summary
    const importStats = importStore.getStats();
    const callStats = callStore.getStats();

    console.log('\n' + '='.repeat(60));
    console.log('COMPLETE');
    console.log('='.repeat(60));
    console.log(`Files processed: ${processed}`);
    console.log(`Errors: ${errors}`);
    console.log(`Import graph: ${importStats.nodes} nodes, ${importStats.edges} edges`);
    console.log(`Call graph: ${callStats.nodes} nodes, ${callStats.edges} edges`);
    console.log(`\nOutput: ${artifactDir}/import-edgelist.json`);
    console.log(`        ${artifactDir}/call-edgelist.json`);
}

main().catch(e => {
    console.error('Script failed:', e);
    process.exit(1);
});
