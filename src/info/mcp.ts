/**
 * MCP Integration for File Info
 * 
 * Contains all MCP-related logic for file_info tool.
 * The MCP module (src/mcp/tools.ts) calls into these functions.
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildGraphs } from '../graph';
import { readArtifacts } from '../graph/artifact/reader';
import { readFile } from '../artifact/storage';
import { getWorkspaceRoot } from '../artifact/service';
import { buildReverseCallIndex } from './reverse-index';
import { extractFileInfo } from './extractor';
import { renderFileInfoMarkdown } from './renderer';
import { FileInfo, ReverseCallIndex } from './types';

/**
 * Enriched function data from LLM
 */
export interface EnrichedFunction {
    name: string;
    purpose: string;
    implementation: string;
}

/**
 * LLM enrichment data for a file
 */
export interface EnrichedFileData {
    path: string;
    overview: string;
    inputs?: string;
    outputs?: string;
    functions: EnrichedFunction[];
}

/**
 * Data prepared for MCP file_info tool
 */
export interface FileInfoMcpData {
    filePath: string;
    markdown: string;
    info: FileInfo;
    sourceCode: string;
}

/**
 * Get file info data for MCP tool
 * 
 * @param rootDir Workspace root directory
 * @param filePath Relative path to the file
 * @returns Data needed for MCP prompt
 */
export async function getFileInfoForMcp(
    rootDir: string,
    filePath: string
): Promise<FileInfoMcpData> {
    const artifactsDir = path.join(rootDir, '.artifacts');

    // Build graphs
    const { callGraph } = await buildGraphs(artifactsDir);

    // Read artifacts
    const artifacts = readArtifacts(artifactsDir);

    // Build reverse index
    const reverseIndex = buildReverseCallIndex(callGraph);

    // Find the artifact for this file
    const normalizedPath = filePath.replace(/\\/g, '/');
    const bundle = artifacts.find(a => {
        const artifactPath = a.fileId.replace(/\\/g, '/');
        return artifactPath === normalizedPath ||
            artifactPath.endsWith('/' + normalizedPath) ||
            normalizedPath.endsWith('/' + artifactPath);
    });

    if (!bundle) {
        throw new Error(`No artifact found for file: ${filePath}`);
    }

    // Extract file info
    const info = extractFileInfo(bundle.fileId, bundle.artifact, reverseIndex);
    const markdown = renderFileInfoMarkdown(info);

    // Read source code
    const fullPath = path.join(rootDir, filePath);
    const sourceCode = await readFile(fullPath) || '';

    return {
        filePath: bundle.fileId,
        markdown,
        info,
        sourceCode
    };
}

/**
 * Build the enrichment prompt for the LLM
 * 
 * @param filePath File path
 * @param fileInfoMarkdown Structural info markdown
 * @param sourceCode Full source code of the file
 * @returns Prompt string for LLM
 */
export function buildEnrichmentPrompt(
    filePath: string,
    fileInfoMarkdown: string,
    sourceCode: string
): string {
    return `You are a Code Documentation Assistant.

I have extracted structural information for file: "${filePath}"

## Structural Info (functions, classes, callers):
${fileInfoMarkdown}

## Source Code:
\`\`\`typescript
${sourceCode}
\`\`\`

## Your Task:

1. Write an **Overview** of this file, be as complete as possible, but succinct: 
   - What is its main purpose?
   - What are its inputs and outputs?
   - What other files depend on it or does it depend on?

2. For EACH function/method listed above:
   - Write a **Purpose** (1 sentence: what does it do?)
   - Write an **Implementation Summary** (3-5 bullet points explaining HOW it works, detailed enough that someone could reimplement it)

3. When done, call the \`report_file_info\` tool with your analysis:
   \`\`\`json
   {
     "path": "${filePath}",
     "overview": "...",
     "inputs": "...",
     "outputs": "...",
     "functions": [
       { "name": "functionName", "purpose": "...", "implementation": "..." }
     ]
   }
   \`\`\`

Focus on being accurate and complete. The goal is documentation detailed enough to reimplement each function.`;
}

/**
 * Render enriched file info as markdown
 */
function renderEnrichedMarkdown(
    originalInfo: FileInfo,
    enriched: EnrichedFileData
): string {
    const lines: string[] = [];

    // Header
    lines.push(`# ${enriched.path}`);
    lines.push('');

    // Overview
    lines.push('## Overview');
    lines.push('');
    lines.push(enriched.overview);
    lines.push('');

    if (enriched.inputs || enriched.outputs) {
        if (enriched.inputs) {
            lines.push(`**Inputs:** ${enriched.inputs}`);
        }
        if (enriched.outputs) {
            lines.push(`**Outputs:** ${enriched.outputs}`);
        }
        lines.push('');
    }

    lines.push('---');
    lines.push('');

    // Functions section
    if (originalInfo.functions.length > 0) {
        lines.push('## Functions');
        lines.push('');

        for (const func of originalInfo.functions) {
            const exportMark = func.isExported ? ' *(exported)*' : '';
            lines.push(`### \`${func.signature}\`${exportMark}`);
            lines.push('');

            // Find enriched data for this function
            const enrichedFunc = enriched.functions.find(f => f.name === func.name);
            if (enrichedFunc) {
                lines.push(`**Purpose:** ${enrichedFunc.purpose}`);
                lines.push('');
                lines.push('**Implementation:**');
                lines.push(enrichedFunc.implementation);
                lines.push('');
            }

            // Called by
            if (func.calledBy.length > 0) {
                lines.push('**Called by:**');
                for (const caller of func.calledBy) {
                    lines.push(`- \`${caller.name}\` in \`${caller.file}\``);
                }
                lines.push('');
            }
        }
    }

    // Classes section
    if (originalInfo.classes.length > 0) {
        lines.push('## Classes');
        lines.push('');

        for (const cls of originalInfo.classes) {
            const exportMark = cls.isExported ? ' *(exported)*' : '';
            lines.push(`### \`${cls.signature}\`${exportMark}`);
            lines.push('');

            if (cls.methods.length > 0) {
                lines.push('#### Methods');
                lines.push('');

                for (const method of cls.methods) {
                    lines.push(`##### \`${method.signature}\``);
                    lines.push('');

                    const enrichedMethod = enriched.functions.find(f => f.name === method.name);
                    if (enrichedMethod) {
                        lines.push(`**Purpose:** ${enrichedMethod.purpose}`);
                        lines.push('');
                        lines.push('**Implementation:**');
                        lines.push(enrichedMethod.implementation);
                        lines.push('');
                    }

                    if (method.calledBy.length > 0) {
                        lines.push('**Called by:**');
                        for (const caller of method.calledBy) {
                            lines.push(`- \`${caller.name}\` in \`${caller.file}\``);
                        }
                        lines.push('');
                    }
                }
            }
        }
    }

    return lines.join('\n');
}

/**
 * Save enriched file info to disk
 * 
 * @param rootDir Workspace root
 * @param originalInfo Original extracted file info
 * @param enriched LLM-enriched data
 * @returns Path to saved file
 */
export async function saveEnrichedFileInfo(
    rootDir: string,
    originalInfo: FileInfo,
    enriched: EnrichedFileData
): Promise<string> {
    const markdown = renderEnrichedMarkdown(originalInfo, enriched);

    // Output path: .artifacts/src/<path>/file_name/file_name.md
    const normalizedPath = enriched.path.replace(/\\/g, '/');
    const fileName = path.basename(normalizedPath);
    const outputPath = path.join(rootDir, '.artifacts', normalizedPath, fileName + '.md');

    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // Write file
    fs.writeFileSync(outputPath, markdown, 'utf-8');

    return outputPath;
}
