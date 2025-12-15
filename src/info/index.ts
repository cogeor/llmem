/**
 * File Info Module - Public API
 * 
 * Generates human-readable markdown documentation for source files
 * with function signatures and call relationships.
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildGraphs } from '../graph';
import { readArtifacts, ArtifactBundle } from '../graph/artifact/reader';
import { buildReverseCallIndex } from './reverse-index';
import { extractFileInfo } from './extractor';
import { renderFileInfoMarkdown } from './renderer';
import { FileInfo, ReverseCallIndex } from './types';

// Re-export types
export * from './types';
export { extractFileInfo } from './extractor';
export { renderFileInfoMarkdown } from './renderer';
export { buildReverseCallIndex } from './reverse-index';
export * from './mcp';

/**
 * Generate file info markdown for a single file
 * 
 * @param fileId The file identifier (relative path)
 * @param artifact The parsed file artifact
 * @param reverseIndex The reverse call index
 * @returns Markdown string with file documentation
 */
export function generateSingleFileInfo(
    fileId: string,
    artifact: import('../parser/types').FileArtifact,
    reverseIndex: ReverseCallIndex
): string {
    const info = extractFileInfo(fileId, artifact, reverseIndex);
    return renderFileInfoMarkdown(info);
}

/**
 * Get the output path for a file's info markdown
 * 
 * @param rootDir The workspace root directory
 * @param fileId The file identifier (relative path, e.g., "src/parser/types.ts")
 * @returns Absolute path to the output markdown file
 */
export function getInfoOutputPath(rootDir: string, fileId: string): string {
    // Input: src/parser/types.ts
    // Output: .artifacts/src/parser/types.ts/types.ts.md
    const normalizedPath = fileId.replace(/\\/g, '/');
    const fileName = path.basename(normalizedPath);
    return path.join(rootDir, '.artifacts', normalizedPath, fileName + '.md');
}

/**
 * Generate file info markdown for all files in a directory
 * 
 * @param rootDir The workspace root directory
 * @param artifactsDir Optional custom artifacts directory (defaults to rootDir/.artifacts)
 * @returns Map of file paths to their generated markdown
 */
export async function generateAllFileInfo(
    rootDir: string,
    artifactsDir?: string
): Promise<Map<string, string>> {
    const results = new Map<string, string>();

    // Build graphs to get call relationships
    const { callGraph } = await buildGraphs(artifactsDir || path.join(rootDir, '.artifacts'));

    // Read all artifacts
    const artifacts = readArtifacts(artifactsDir || path.join(rootDir, '.artifacts'));

    // Build reverse call index
    const reverseIndex = buildReverseCallIndex(callGraph);

    // Generate info for each file
    for (const { fileId, artifact } of artifacts) {
        const markdown = generateSingleFileInfo(fileId, artifact, reverseIndex);
        results.set(fileId, markdown);
    }

    return results;
}

/**
 * Generate and save file info markdown for all files
 * 
 * @param rootDir The workspace root directory
 * @returns List of generated file paths
 */
export async function generateAndSaveAllFileInfo(rootDir: string): Promise<string[]> {
    const artifactsDir = path.join(rootDir, '.artifacts');
    const results = await generateAllFileInfo(rootDir, artifactsDir);
    const savedPaths: string[] = [];

    for (const [fileId, markdown] of results) {
        const outputPath = getInfoOutputPath(rootDir, fileId);

        // Ensure directory exists
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Write markdown file
        fs.writeFileSync(outputPath, markdown, 'utf-8');
        savedPaths.push(outputPath);
    }

    return savedPaths;
}
