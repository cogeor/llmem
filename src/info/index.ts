/**
 * File Info Module - Public API
 * 
 * Generates human-readable markdown documentation for source files
 * with function signatures and call relationships.
 * 
 * NOTE: The graph-based functions have been disabled pending edge list integration.
 */

import * as fs from 'fs';
import * as path from 'path';
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
export * from './filter';

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

// NOTE: generateAllFileInfo and generateAndSaveAllFileInfo have been disabled
// pending edge list integration. They relied on legacy artifact reading.
