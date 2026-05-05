/**
 * File Info Module - Public API
 *
 * Generates human-readable markdown documentation for source files
 * with function signatures and call relationships.
 *
 * NOTE: The graph-based functions have been disabled pending edge list integration.
 *
 * Loop 07: the MCP-prompt-building surface previously exported from
 * `./mcp` has moved to `src/application/document-file.ts`. The
 * remaining helpers in this module are domain-shaped extractors used
 * by the application layer.
 */

import * as path from 'path';
import { extractFileInfo } from './extractor';
import { renderFileInfoMarkdown } from './renderer';
import { ReverseCallIndex } from './types';

// Re-export types
export * from './types';
export { extractFileInfo } from './extractor';
export { renderFileInfoMarkdown } from './renderer';
export { buildReverseCallIndex } from './reverse-index';
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
 * Loop 10: previously took `(rootDir, fileId)` and joined a hardcoded
 * artifact-root literal under the workspace root — a Loop 09 leftover
 * that the artifact-root-allowlist test surfaces. The function has no
 * runtime callers (the legacy generators are disabled — see the NOTE
 * below), so the signature was tightened to take the configured
 * artifact root directly. Callers that get here in the future should
 * pass `ctx.artifactRoot` from the application layer.
 *
 * @param artifactRoot The configured artifact root directory (e.g. `ctx.artifactRoot`)
 * @param fileId The file identifier (relative path, e.g., "src/parser/types.ts")
 * @returns Absolute path to the output markdown file
 */
export function getInfoOutputPath(artifactRoot: string, fileId: string): string {
    // Input: src/parser/types.ts
    // Output: <artifactRoot>/src/parser/types.ts/types.ts.md
    const normalizedPath = fileId.replace(/\\/g, '/');
    const fileName = path.basename(normalizedPath);
    return path.join(artifactRoot, normalizedPath, fileName + '.md');
}

// NOTE: generateAllFileInfo and generateAndSaveAllFileInfo have been disabled
// pending edge list integration. They relied on legacy artifact reading.
