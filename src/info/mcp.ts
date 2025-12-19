/**
 * MCP Integration for File Info
 * 
 * Contains all MCP-related logic for file_info tool.
 * The MCP module (src/mcp/tools.ts) calls into these functions.
 * 
 * NOTE: getFileInfoForMcp has been disabled pending edge list integration.
 */

import * as fs from 'fs';
import * as path from 'path';
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
 * Extracts file info using TypeScript service and converts to edge list format.
 * Returns all data needed for LLM enrichment prompt.
 * 
 * @param rootDir Workspace root directory
 * @param filePath Relative path to the file
 * @returns Data needed for MCP prompt
 */
export async function getFileInfoForMcp(
    rootDir: string,
    filePath: string
): Promise<FileInfoMcpData> {
    const absolutePath = path.join(rootDir, filePath);

    // Check file exists
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    // Read source code
    const sourceCode = fs.readFileSync(absolutePath, 'utf-8');

    // Initialize TypeScript service and extract artifact
    const { TypeScriptService } = await import('../parser/ts-service');
    const { TypeScriptExtractor } = await import('../parser/ts-extractor');
    const { artifactToEdgeList } = await import('../graph/artifact-converter');
    const { getImportEdges, getCallEdges, filterImportEdges } = await import('./filter');

    const tsService = new TypeScriptService(rootDir);
    const tsExtractor = new TypeScriptExtractor(() => tsService.getProgram(), rootDir);

    const artifact = await tsExtractor.extract(absolutePath);
    if (!artifact) {
        throw new Error(`Failed to extract artifact from ${filePath}`);
    }

    // Convert to edge list
    const { nodes, edges } = artifactToEdgeList(artifact, filePath);

    // Build file info markdown (similar to CLI output)
    const importEdges = filterImportEdges(getImportEdges(edges));
    const callEdges = getCallEdges(edges);

    // Build markdown representation
    const lines: string[] = [];

    lines.push('### IMPORTS');
    if (importEdges.length === 0) {
        lines.push('(none)');
    } else {
        for (const edge of importEdges) {
            lines.push(`- → ${edge.target}`);
        }
    }
    lines.push('');

    lines.push('### ENTITIES');
    const entityNodes = nodes.filter(n => n.kind !== 'file');
    if (entityNodes.length === 0) {
        lines.push('(none)');
    } else {
        for (const node of entityNodes) {
            const entity = artifact.entities.find(e => e.name === node.name);
            const exportMark = entity?.isExported ? ' [exported]' : '';
            const sig = entity?.signature ? ` - \`${entity.signature}\`` : '';
            lines.push(`- **${node.name}** (${node.kind})${exportMark}${sig}`);
        }
    }
    lines.push('');

    lines.push('### CALL EDGES');
    const stdlibFunctions = new Set([
        'push', 'pop', 'shift', 'unshift', 'splice', 'slice', 'concat',
        'map', 'filter', 'reduce', 'forEach', 'find', 'findIndex', 'some', 'every',
        'includes', 'indexOf', 'join', 'split', 'trim', 'replace', 'match',
        'toString', 'valueOf', 'hasOwnProperty',
        'get', 'set', 'has', 'delete', 'clear', 'add', 'keys', 'values', 'entries',
        'next', 'done', 'then', 'catch', 'finally',
        'log', 'error', 'warn', 'info', 'debug',
        'Map', 'Set', 'Promise', 'Error', 'JSON', 'Object', 'Array'
    ]);

    const filteredCallEdges = callEdges.filter(edge => {
        const targetName = edge.target.includes('::') ? edge.target.split('::').pop()! : edge.target;
        return !stdlibFunctions.has(targetName);
    });

    if (filteredCallEdges.length === 0) {
        lines.push('(none)');
    } else {
        for (const edge of filteredCallEdges) {
            const sourceName = edge.source.includes('::') ? edge.source.split('::').pop()! : edge.source;
            const targetFile = edge.target.includes('::') ? edge.target.split('::')[0] : edge.target;
            const targetName = edge.target.includes('::') ? edge.target.split('::').pop()! : edge.target;

            if (targetFile === filePath) {
                lines.push(`- ${sourceName} → ${targetName}`);
            } else {
                lines.push(`- ${sourceName} → ${targetFile}:${targetName}`);
            }
        }
    }

    const markdown = lines.join('\n');

    // Build FileInfo for compatibility
    const info: FileInfo = extractFileInfo(filePath, artifact, new Map());

    return {
        filePath,
        markdown,
        info,
        sourceCode
    };
}

/**
 * Build the enrichment prompt for the LLM
 * 
 * Creates an extremely detailed prompt that produces documentation
 * sufficient to reimplement the entire file from scratch.
 * 
 * @param filePath File path
 * @param fileInfoMarkdown Structural info markdown (imports, entities, call edges)
 * @param sourceCode Full source code of the file
 * @returns Prompt string for LLM
 */
export function buildEnrichmentPrompt(
    filePath: string,
    fileInfoMarkdown: string,
    sourceCode: string
): string {
    const lineCount = sourceCode.split('\n').length;
    const language = filePath.endsWith('.ts') || filePath.endsWith('.tsx') ? 'typescript' :
        filePath.endsWith('.py') ? 'python' : 'code';

    return `# DESIGN DOCUMENT GENERATION TASK

## LLM CONFIGURATION
- **max_tokens:** 16000
- **reasoning:** enabled - Use chain-of-thought reasoning. Think step by step before writing each section.
- **temperature:** 0.3 (be precise and accurate)

> **IMPORTANT:** This is a complex documentation task. Take your time to:
> 1. First, read and understand the entire source code
> 2. Identify all key relationships and dependencies
> 3. Then systematically document each component
> Do not rush. Quality and completeness are more important than speed.

---

You are a senior software architect creating a **Design Document** for a source file.
The document must be detailed enough that another developer could **reimplement the entire file** from it.

## FILE BEING DOCUMENTED
- **Path:** \`${filePath}\`
- **Language:** ${language}
- **Lines:** ${lineCount}

---

## STRUCTURAL ANALYSIS (auto-extracted)

${fileInfoMarkdown}

---

## SOURCE CODE

\`\`\`${language}
${sourceCode}
\`\`\`

---

## YOUR TASK: Generate a Complete Design Document

Create documentation with the following sections. Be **extremely detailed** - assume the reader cannot see the source code.

### 1. FILE OVERVIEW
- **Purpose:** What problem does this file solve? What is its role in the system?
- **Dependencies:** What does it import and why? (both internal and external)
- **Consumers:** Who uses this file? What API does it expose?
- **Key Concepts:** What domain concepts or patterns does it implement?

### 2. DATA STRUCTURES
For each interface, type, class, or constant:
- **Name and Purpose:** What data does it represent?
- **Fields:** Each field with its type and meaning
- **Invariants:** Any constraints or relationships between fields
- **Usage Pattern:** How is this data typically created/used?

### 3. FUNCTION SPECIFICATIONS
For EACH function/method (this is critical):

#### \`functionName(params): returnType\`
- **Purpose:** One sentence describing what it does
- **Parameters:** 
  - Each parameter with type, meaning, and valid values
- **Return Value:** What is returned and when
- **Side Effects:** Any mutations, I/O, or state changes
- **Algorithm (DETAILED):**
  - Step-by-step breakdown of the implementation
  - Include edge cases handled
  - Include any branching logic
  - Detail enough to reimplement without seeing code
- **Dependencies:** What other functions/modules does it call?
- **Error Handling:** What errors can occur and how are they handled?

### 4. CONTROL FLOW
- How do the functions interact?
- What is the typical call sequence?
- Draw the data flow through the module

### 5. REIMPLEMENTATION NOTES
- Tricky implementation details that might be missed
- Performance considerations
- Edge cases that must be handled
- Assumptions made by the code

---

## OUTPUT FORMAT

After your analysis, call the \`report_file_info\` tool with:

\`\`\`json
{
  "path": "${filePath}",
  "overview": "<detailed overview section as markdown>",
  "inputs": "<what the file takes as input: imports, parameters, dependencies>",
  "outputs": "<what the file produces: exports, side effects, return values>",
  "functions": [
    {
      "name": "<function name>",
      "purpose": "<one sentence purpose>",
      "implementation": "<detailed algorithm in bullet points, 5-10 points minimum>"
    }
  ]
}
\`\`\`

**IMPORTANT:** The implementation field must contain enough detail to reimplement the function without seeing the original code. Include specific logic, conditions, data transformations, and edge cases.`;
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
    // DISABLED: Legacy artifact system deprecated, using edge list instead
    console.log('[info/mcp] saveEnrichedFileInfo disabled - using edge list');
    return '';

    /* Legacy code preserved for future lazy loading:
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
    */
}

