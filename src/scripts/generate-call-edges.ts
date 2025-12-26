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

    // Load existing edge lists
    const callStore = new CallEdgeListStore(artifactDir);
    const importStore = new ImportEdgeListStore(artifactDir);
    await callStore.load();
    await importStore.load();
    const existingCallEdgeCount = callStore.getStats().edges;
    const existingImportEdgeCount = importStore.getStats().edges;

    console.log(`[GenerateEdges] Processing folder: ${folderPath}`);
    console.log(`[GenerateEdges] Existing edges - call: ${existingCallEdgeCount}, import: ${existingImportEdgeCount}`);

    // Count lines in folder
    const lineCount = countFolderLines(projectRoot, absoluteFolder);
    console.log(`[GenerateEdges] Folder stats: ${lineCount.fileCount} files, ${lineCount.totalLines} lines`);

    // Get parser registry (language-agnostic)
    const { ParserRegistry } = await import('../parser/registry');
    const registry = ParserRegistry.getInstance();

    // Find all supported files in the folder (not recursive, only direct children)
    const entries = fs.readdirSync(absoluteFolder);
    const sourceFiles: string[] = [];

    for (const entry of entries) {
        const entryPath = path.join(absoluteFolder, entry);
        const stat = fs.statSync(entryPath);

        if (stat.isFile() && registry.isSupported(entry)) {
            sourceFiles.push(entryPath);
        }
    }

    console.log(`[GenerateEdges] Found ${sourceFiles.length} supported files in folder`);

    let processedCount = 0;
    let newCallEdgeCount = 0;
    let newImportEdgeCount = 0;

    for (const absoluteFilePath of sourceFiles) {
        const relativePath = path.relative(projectRoot, absoluteFilePath).replace(/\\/g, '/');
        const parser = registry.getParser(absoluteFilePath, projectRoot);

        if (!parser) {
            console.warn(`[GenerateEdges] No parser for ${relativePath}`);
            continue;
        }

        const langId = registry.getLanguageId(absoluteFilePath);
        console.log(`[GenerateEdges] Processing ${langId} file: ${relativePath}`);

        try {
            const artifact = await parser.extract(absoluteFilePath);
            if (!artifact) continue;

            const { nodes, callEdges, importEdges } = artifactToEdgeList(artifact, relativePath);

            // Add nodes to both stores
            callStore.addNodes(nodes);
            importStore.addNodes(nodes);

            // Add call edges
            for (const edge of callEdges) {
                callStore.addEdge(edge);
            }
            newCallEdgeCount += callEdges.length;

            // Add import edges
            for (const edge of importEdges) {
                importStore.addEdge(edge);
            }
            newImportEdgeCount += importEdges.length;

            processedCount++;
        } catch (e: any) {
            console.warn(`[GenerateEdges] Skip ${relativePath}: ${e.message}`);
        }
    }

    // Save updated edge lists
    await callStore.save();
    await importStore.save();

    const finalCallEdgeCount = callStore.getStats().edges;
    const finalImportEdgeCount = importStore.getStats().edges;
    const actualNewCallEdges = finalCallEdgeCount - existingCallEdgeCount;
    const actualNewImportEdges = finalImportEdgeCount - existingImportEdgeCount;

    console.log(`[GenerateEdges] Processed ${processedCount} files, added ${actualNewCallEdges} call edges, ${actualNewImportEdges} import edges`);

    return {
        newEdges: actualNewCallEdges + actualNewImportEdges,
        totalEdges: finalCallEdgeCount + finalImportEdgeCount
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

    // Load existing edge lists
    const callStore = new CallEdgeListStore(artifactDir);
    const importStore = new ImportEdgeListStore(artifactDir);
    await callStore.load();
    await importStore.load();
    const existingCallEdgeCount = callStore.getStats().edges;
    const existingImportEdgeCount = importStore.getStats().edges;

    console.log(`[GenerateEdges] Processing file: ${filePath}`);
    console.log(`[GenerateEdges] Existing edges - call: ${existingCallEdgeCount}, import: ${existingImportEdgeCount}`);

    // Get parser from registry (language-agnostic)
    const { ParserRegistry } = await import('../parser/registry');
    const registry = ParserRegistry.getInstance();
    const parser = registry.getParser(filePath, projectRoot);

    if (!parser) {
        const fileExt = path.extname(filePath).toLowerCase();
        console.warn(`[GenerateEdges] Unsupported file type: ${fileExt}`);
        console.warn(`[GenerateEdges] Supported extensions: ${registry.getSupportedExtensions().join(', ')}`);
        return { newEdges: 0, totalEdges: callStore.getStats().edges };
    }

    const langId = registry.getLanguageId(filePath);
    console.log(`[GenerateEdges] Processing ${langId} file: ${filePath}`);

    try {
        const artifact = await parser.extract(absoluteFile);
        if (!artifact) {
            throw new Error('No artifact extracted');
        }

        const { nodes, callEdges, importEdges } = artifactToEdgeList(artifact, filePath);

        // Add nodes to both stores
        callStore.addNodes(nodes);
        importStore.addNodes(nodes);

        // Add call edges
        for (const edge of callEdges) {
            callStore.addEdge(edge);
        }

        // Add import edges
        for (const edge of importEdges) {
            importStore.addEdge(edge);
        }

        // Save updated edge lists
        await callStore.save();
        await importStore.save();

        const finalCallEdgeCount = callStore.getStats().edges;
        const finalImportEdgeCount = importStore.getStats().edges;
        const actualNewCallEdges = finalCallEdgeCount - existingCallEdgeCount;
        const actualNewImportEdges = finalImportEdgeCount - existingImportEdgeCount;

        console.log(`[GenerateEdges] Processed file, added ${actualNewCallEdges} call edges, ${actualNewImportEdges} import edges`);

        return {
            newEdges: actualNewCallEdges + actualNewImportEdges,
            totalEdges: finalCallEdgeCount + finalImportEdgeCount
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

// Only run main() if this file is executed directly (not imported as a module)
if (require.main === module) {
    main().catch(e => {
        console.error('Script failed:', e);
        process.exit(1);
    });
}
