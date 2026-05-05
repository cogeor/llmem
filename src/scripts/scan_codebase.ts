/**
 * Scan codebase and populate split edge lists.
 *
 * Run with: npx ts-node src/scripts/scan_codebase.ts
 */

import * as path from 'path';
import { ImportEdgeListStore, CallEdgeListStore, SchemaMismatchError } from '../graph/edgelist';
import { TypeScriptExtractor } from '../parser/ts-extractor';
import { TypeScriptService } from '../parser/ts-service';
import { artifactToEdgeList } from '../graph/artifact-converter';
import { loadConfig, getConfig } from '../extension/config';
import { createWorkspaceContext } from '../application/workspace-context';

async function scan() {
    console.log('='.repeat(60));
    console.log('CODEBASE SCANNER - Split Edge List Population');
    console.log('='.repeat(60));

    // Load config
    loadConfig();
    const config = getConfig();

    // Loop 07: build a per-script WorkspaceContext so the edge-list stores
    // get a real `WorkspaceIO` (mandatory after this loop).
    const ctx = await createWorkspaceContext({
        workspaceRoot: process.cwd(),
        configOverrides: { artifactRoot: config.artifactRoot },
    });
    const root = ctx.workspaceRoot;
    const artifactDir = ctx.artifactRoot;

    console.log(`\nRoot: ${root}`);
    console.log(`Artifact dir: ${artifactDir}`);

    // Ensure artifact directory exists. `io.mkdirRecursive` is idempotent
    // and asserts containment.
    const artifactRel = path.relative(ctx.io.getRealRoot(), artifactDir).replace(/\\/g, '/');
    await ctx.io.mkdirRecursive(artifactRel);

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
    const normalizedRoot = (root as string).replace(/\\/g, '/');
    const sourceFiles = program.getSourceFiles().filter(sf => {
        const filePath = sf.fileName.replace(/\\/g, '/');
        // Skip node_modules and declaration files
        return !filePath.includes('node_modules') &&
            !filePath.endsWith('.d.ts') &&
            filePath.startsWith(normalizedRoot);
    });

    console.log(`\nFound ${sourceFiles.length} TypeScript files to scan`);

    // Create split edge list stores
    const importStore = new ImportEdgeListStore(artifactDir, ctx.io);
    const callStore = new CallEdgeListStore(artifactDir, ctx.io);
    // Loop 13 (codebase-quality-v2): the load is followed by clear()
    // anyway, so a SchemaMismatchError on a stale envelope is
    // structurally a no-op — the clear discards what the load
    // produced. But load() throws BEFORE clear() runs, so swallow that
    // specific error here. Any other load failure (parse / schema
    // shape) is still a real bug worth surfacing.
    for (const store of [importStore, callStore]) {
        try {
            await store.load();
        } catch (e) {
            if (e instanceof SchemaMismatchError) {
                console.warn(`  WARN: ${e.message}`);
                console.warn('  (about to clear() and write a fresh v_next envelope)');
            } else {
                throw e;
            }
        }
    }
    importStore.clear(); // Start fresh
    callStore.clear();

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
            const { nodes, importEdges, callEdges } = artifactToEdgeList(artifact, relativePath);

            // Add nodes to both stores
            importStore.addNodes(nodes);
            callStore.addNodes(nodes);

            // Add edges to respective stores
            importStore.addEdges(importEdges);
            callStore.addEdges(callEdges);

            processedCount++;
            if (processedCount % 20 === 0) {
                console.log(`  Processed ${processedCount} files...`);
            }
        } catch (e: any) {
            console.error(`  ERROR: ${relativePath}: ${e.message}`);
            errorCount++;
        }
    }

    // Save edge lists
    console.log('\nSaving edge lists...');
    await importStore.save();
    await callStore.save();

    // Print summary
    const importStats = importStore.getStats();
    const callStats = callStore.getStats();
    console.log('\n' + '='.repeat(60));
    console.log('SCAN COMPLETE');
    console.log('='.repeat(60));
    console.log(`Files processed: ${processedCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`Import graph: ${importStats.nodes} nodes, ${importStats.edges} edges`);
    console.log(`Call graph: ${callStats.nodes} nodes, ${callStats.edges} edges`);
    console.log(`\nEdge lists saved to: ${artifactDir}/import-edgelist.json`);
    console.log(`                     ${artifactDir}/call-edgelist.json`);
}

scan().catch(e => {
    console.error('Scan failed:', e);
    process.exit(1);
});
