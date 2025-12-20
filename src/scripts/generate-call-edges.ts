#!/usr/bin/env npx ts-node
/**
 * Generate Call Edges for a Folder
 * 
 * Run: npx ts-node src/scripts/generate-call-edges.ts <folder-path>
 * 
 * This script generates call edges for a specific folder that was 
 * deferred during initial scanning due to size threshold.
 * 
 * Edges are appended to the existing call-edgelist.json with deduplication.
 */

import * as path from 'path';
import * as fs from 'fs';
import { CallEdgeListStore, ImportEdgeListStore } from '../graph/edgelist';
import { TypeScriptService } from '../parser/ts-service';
import { TypeScriptExtractor } from '../parser/ts-extractor';
import { artifactToEdgeList } from '../graph/artifact-converter';
import { countFolderLines } from '../parser/line-counter';
import { IGNORED_FOLDERS } from '../parser/config';

/**
 * Generate call edges for files in a specific folder.
 * Appends to existing edge list with deduplication.
 * 
 * @param projectRoot Workspace root
 * @param folderPath Relative folder path (e.g., "src/parser")
 * @param artifactDir Directory containing edge list files
 * @returns Number of new edges added
 */
export async function generateCallEdgesForFolder(
    projectRoot: string,
    folderPath: string,
    artifactDir: string
): Promise<{ newEdges: number; totalEdges: number }> {
    const absoluteFolder = path.join(projectRoot, folderPath);

    if (!fs.existsSync(absoluteFolder)) {
        throw new Error(`Folder not found: ${folderPath}`);
    }

    // Load existing call edge list
    const callStore = new CallEdgeListStore(artifactDir);
    await callStore.load();
    const existingEdgeCount = callStore.getStats().edges;

    console.log(`[GenerateCallEdges] Processing folder: ${folderPath}`);
    console.log(`[GenerateCallEdges] Existing call edges: ${existingEdgeCount}`);

    // Count lines in folder
    const lineCount = countFolderLines(projectRoot, absoluteFolder);
    console.log(`[GenerateCallEdges] Folder stats: ${lineCount.fileCount} files, ${lineCount.totalLines} lines`);

    // Initialize TypeScript service
    const tsService = new TypeScriptService(projectRoot);
    const tsExtractor = new TypeScriptExtractor(() => tsService.getProgram(), projectRoot);

    const program = tsService.getProgram();
    if (!program) {
        throw new Error('Failed to create TypeScript program');
    }

    // Get source files in this folder
    const normalizedRoot = projectRoot.replace(/\\/g, '/');
    const normalizedFolder = path.join(normalizedRoot, folderPath).replace(/\\/g, '/');

    const sourceFiles = program.getSourceFiles().filter(sf => {
        const filePath = sf.fileName.replace(/\\/g, '/');
        return !filePath.includes('node_modules') &&
            !filePath.endsWith('.d.ts') &&
            filePath.startsWith(normalizedFolder + '/') || filePath === normalizedFolder;
    });

    console.log(`[GenerateCallEdges] Found ${sourceFiles.length} TypeScript files in folder`);

    let processedCount = 0;
    let newEdgeCount = 0;

    for (const sf of sourceFiles) {
        const filePath = sf.fileName;
        const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');

        // Skip if not directly in the target folder (only process direct children)
        const fileFolder = path.dirname(relativePath);
        if (fileFolder !== folderPath) continue;

        try {
            const artifact = await tsExtractor.extract(filePath);
            if (!artifact) continue;

            const { nodes, callEdges } = artifactToEdgeList(artifact, relativePath);

            // Add nodes (may already exist, addNode handles deduplication)
            callStore.addNodes(nodes);

            // Add call edges (addEdge handles deduplication)
            for (const edge of callEdges) {
                callStore.addEdge(edge);
            }

            processedCount++;
            newEdgeCount += callEdges.length;
        } catch (e: any) {
            console.warn(`[GenerateCallEdges] Skip ${relativePath}: ${e.message}`);
        }
    }

    // Save updated edge list
    await callStore.save();

    const finalEdgeCount = callStore.getStats().edges;
    const actualNewEdges = finalEdgeCount - existingEdgeCount;

    console.log(`[GenerateCallEdges] Processed ${processedCount} files, added ${actualNewEdges} new edges`);

    return {
        newEdges: actualNewEdges,
        totalEdges: finalEdgeCount
    };
}

/**
 * Generate call edges for a single file.
 * Appends to existing edge list with deduplication.
 * 
 * @param projectRoot Workspace root
 * @param filePath Relative file path (e.g., "src/parser/ts-extractor.ts")
 * @param artifactDir Directory containing edge list files
 * @returns Number of new edges added
 */
export async function generateCallEdgesForFile(
    projectRoot: string,
    filePath: string,
    artifactDir: string
): Promise<{ newEdges: number; totalEdges: number }> {
    const absoluteFile = path.join(projectRoot, filePath);

    if (!fs.existsSync(absoluteFile)) {
        throw new Error(`File not found: ${filePath}`);
    }

    // Load existing call edge list
    const callStore = new CallEdgeListStore(artifactDir);
    await callStore.load();
    const existingEdgeCount = callStore.getStats().edges;

    console.log(`[GenerateCallEdges] Processing file: ${filePath}`);
    console.log(`[GenerateCallEdges] Existing call edges: ${existingEdgeCount}`);

    // Initialize TypeScript service
    const tsService = new TypeScriptService(projectRoot);
    const tsExtractor = new TypeScriptExtractor(() => tsService.getProgram(), projectRoot);

    const program = tsService.getProgram();
    if (!program) {
        throw new Error('Failed to create TypeScript program');
    }

    try {
        const artifact = await tsExtractor.extract(absoluteFile);
        if (!artifact) {
            throw new Error('No artifact extracted');
        }

        const { nodes, callEdges } = artifactToEdgeList(artifact, filePath);

        // Add nodes
        callStore.addNodes(nodes);

        // Add call edges
        for (const edge of callEdges) {
            callStore.addEdge(edge);
        }

        // Save updated edge list
        await callStore.save();

        const finalEdgeCount = callStore.getStats().edges;
        const actualNewEdges = finalEdgeCount - existingEdgeCount;

        console.log(`[GenerateCallEdges] Processed file, added ${actualNewEdges} new edges`);

        return {
            newEdges: actualNewEdges,
            totalEdges: finalEdgeCount
        };
    } catch (e: any) {
        throw new Error(`Failed to process ${filePath}: ${e.message}`);
    }
}

/**
 * Generate call edges for a folder and all its subfolders recursively.
 */
export async function generateCallEdgesForFolderRecursive(
    projectRoot: string,
    folderPath: string,
    artifactDir: string
): Promise<{ newEdges: number; totalEdges: number }> {
    const absoluteFolder = path.join(projectRoot, folderPath);

    if (!fs.existsSync(absoluteFolder)) {
        throw new Error(`Folder not found: ${folderPath}`);
    }

    let totalNewEdges = 0;

    // Process current folder
    const result = await generateCallEdgesForFolder(projectRoot, folderPath, artifactDir);
    totalNewEdges += result.newEdges;

    // Find subfolders
    const entries = fs.readdirSync(absoluteFolder);
    for (const entry of entries) {
        if (IGNORED_FOLDERS.has(entry)) continue;

        const entryPath = path.join(absoluteFolder, entry);
        if (fs.statSync(entryPath).isDirectory()) {
            const subFolderPath = path.join(folderPath, entry).replace(/\\/g, '/');
            const subResult = await generateCallEdgesForFolderRecursive(projectRoot, subFolderPath, artifactDir);
            totalNewEdges += subResult.newEdges;
        }
    }

    // Load final stats
    const callStore = new CallEdgeListStore(artifactDir);
    await callStore.load();

    return {
        newEdges: totalNewEdges,
        totalEdges: callStore.getStats().edges
    };
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
    const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
    const recursive = process.argv.includes('--recursive') || process.argv.includes('-r');

    if (args.length === 0) {
        console.error('Usage: npx ts-node src/scripts/generate-call-edges.ts <folder-path> [--recursive]');
        console.error('Example: npx ts-node src/scripts/generate-call-edges.ts src/parser');
        console.error('');
        console.error('Options:');
        console.error('  --recursive, -r  Process folder and all subfolders');
        process.exit(1);
    }

    const folderPath = args[0].replace(/\\/g, '/');
    const root = process.cwd();
    const artifactDir = path.join(root, '.artifacts');

    console.log('='.repeat(60));
    console.log('GENERATE CALL EDGES');
    console.log('='.repeat(60));
    console.log(`\nFolder: ${folderPath}`);
    console.log(`Recursive: ${recursive}`);
    console.log(`Artifact dir: ${artifactDir}\n`);

    // Ensure artifact directory exists
    if (!fs.existsSync(artifactDir)) {
        console.error('ERROR: .artifacts directory not found. Run the initial scan first.');
        process.exit(1);
    }

    try {
        const result = recursive
            ? await generateCallEdgesForFolderRecursive(root, folderPath, artifactDir)
            : await generateCallEdgesForFolder(root, folderPath, artifactDir);

        console.log('\n' + '='.repeat(60));
        console.log('COMPLETE');
        console.log('='.repeat(60));
        console.log(`New edges added: ${result.newEdges}`);
        console.log(`Total call edges: ${result.totalEdges}`);
    } catch (e: any) {
        console.error(`\nERROR: ${e.message}`);
        process.exit(1);
    }
}

main().catch(e => {
    console.error('Script failed:', e);
    process.exit(1);
});
