/**
 * Scan codebase and populate edge list.
 * 
 * Run with: npx ts-node src/scripts/scan_codebase.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import { EdgeListStore, NodeEntry, EdgeEntry } from '../graph/edgelist';
import { TypeScriptExtractor } from '../parser/ts-extractor';
import { TypeScriptService } from '../parser/ts-service';
import { artifactToEdgeList } from '../graph/artifact-converter';
import { loadConfig, getConfig } from '../extension/config';

async function scan() {
    console.log('='.repeat(60));
    console.log('CODEBASE SCANNER - Edge List Population');
    console.log('='.repeat(60));

    // Load config
    loadConfig();
    const config = getConfig();

    const root = process.cwd();
    const artifactDir = path.join(root, config.artifactRoot);

    console.log(`\nRoot: ${root}`);
    console.log(`Artifact dir: ${artifactDir}`);

    // Ensure artifact directory exists
    if (!fs.existsSync(artifactDir)) {
        fs.mkdirSync(artifactDir, { recursive: true });
    }

    // Initialize TypeScript service
    console.log('\nInitializing TypeScript service...');
    const tsService = new TypeScriptService(root);
    const tsExtractor = new TypeScriptExtractor(() => tsService.getProgram(), root);

    // Get all TypeScript files
    const program = tsService.getProgram();
    if (!program) {
        console.error('ERROR: Failed to create TypeScript program');
        process.exit(1);
    }

    // Normalize root for comparison (TS compiler may use forward slashes)
    const normalizedRoot = root.replace(/\\/g, '/');
    const sourceFiles = program.getSourceFiles().filter(sf => {
        const filePath = sf.fileName.replace(/\\/g, '/');
        // Skip node_modules and declaration files
        return !filePath.includes('node_modules') &&
            !filePath.endsWith('.d.ts') &&
            filePath.startsWith(normalizedRoot);
    });

    console.log(`\nFound ${sourceFiles.length} TypeScript files to scan`);

    // Create edge list store
    const edgeListStore = new EdgeListStore(artifactDir);
    await edgeListStore.load();
    edgeListStore.clear(); // Start fresh

    // Process each file
    let processedCount = 0;
    let errorCount = 0;

    for (const sf of sourceFiles) {
        const filePath = sf.fileName;
        const relativePath = path.relative(root, filePath).replace(/\\/g, '/');

        try {
            // Extract artifact
            const artifact = await tsExtractor.extract(filePath);
            if (!artifact) {
                console.log(`  SKIP: ${relativePath} (no artifact)`);
                continue;
            }

            // Convert to edge list entries
            const { nodes, edges } = artifactToEdgeList(artifact, relativePath);

            // Add to store
            edgeListStore.addNodes(nodes);
            edgeListStore.addEdges(edges);

            processedCount++;
            if (processedCount % 20 === 0) {
                console.log(`  Processed ${processedCount} files...`);
            }
        } catch (e: any) {
            console.error(`  ERROR: ${relativePath}: ${e.message}`);
            errorCount++;
        }
    }

    // Save edge list
    console.log('\nSaving edge list...');
    await edgeListStore.save();

    // Print summary
    const stats = edgeListStore.getStats();
    console.log('\n' + '='.repeat(60));
    console.log('SCAN COMPLETE');
    console.log('='.repeat(60));
    console.log(`Files processed: ${processedCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`Nodes: ${stats.nodes}`);
    console.log(`Edges: ${stats.edges}`);
    console.log(`  Import edges: ${stats.importEdges}`);
    console.log(`  Call edges: ${stats.callEdges}`);
    console.log(`\nEdge list saved to: ${path.join(artifactDir, 'edgelist.json')}`);
}

scan().catch(e => {
    console.error('Scan failed:', e);
    process.exit(1);
});
