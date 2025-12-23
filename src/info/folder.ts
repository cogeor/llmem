/**
 * Folder Info Extraction and Prompting
 * 
 * Provides functionality to summarize a folder for LLM consumption.
 * Uses the pre-generated split EdgeList graphs (import + call).
 * 
 * Reads existing documentation from .arch/{path}/README.md if present,
 * and saves generated documentation to the same location.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ImportEdgeListStore, CallEdgeListStore, NodeEntry, EdgeEntry } from '../graph/edgelist';
import { getImportEdges, getCallEdges, filterImportEdges, getEdgesForModule } from './filter';

/**
 * Data needed for the folder info prompt
 */
export interface FolderInfoMcpData {
    folderPath: string;
    rootDir: string;           // Absolute workspace root used
    readmePath: string;        // Absolute path to .arch/{path}/README.md
    markdown: string;
    rawEdges: EdgeEntry[];
    stats: {
        files: number;
        nodes: number;
        edges: number;
    };
    existingDocs: string | null;
}


/**
 * Load existing README.md from .arch folder if present
 */
export function loadExistingFolderReadme(
    rootDir: string,
    folderPath: string
): string | null {
    const readmePath = path.join(rootDir, '.arch', folderPath, 'README.md');
    if (fs.existsSync(readmePath)) {
        try {
            return fs.readFileSync(readmePath, 'utf-8');
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * Get folder info data for MCP tool using existing EdgeList
 */
export async function getFolderInfoForMcp(
    rootDir: string,
    folderPath: string
): Promise<FolderInfoMcpData> {
    const absoluteFolderPath = path.join(rootDir, folderPath);
    if (!fs.existsSync(absoluteFolderPath)) {
        throw new Error(`Folder not found: ${folderPath}`);
    }

    // Load existing documentation if present
    const existingDocs = loadExistingFolderReadme(rootDir, folderPath);

    // Load graphs from .artifacts (split stores)
    const artifactDir = path.join(rootDir, '.artifacts');
    if (!fs.existsSync(artifactDir)) {
        throw new Error(`Artifacts directory not found at ${artifactDir}. Please run 'npm run scan' first.`);
    }

    const importStore = new ImportEdgeListStore(artifactDir);
    const callStore = new CallEdgeListStore(artifactDir);
    await importStore.load();
    await callStore.load();

    // Combine edges from both stores for folder analysis
    const allImportEdges = importStore.getEdges();
    const allCallEdges = callStore.getEdges();
    const allEdges = [...allImportEdges, ...allCallEdges];

    // Combine nodes (import store has file nodes, call store has entity nodes)
    const allNodes = [...importStore.getNodes(), ...callStore.getNodes()];

    // Filter edges for this folder (recursive to include subfolders)
    const folderEdges = getEdgesForModule(allEdges, folderPath, true);

    // Identify nodes involved in these edges
    const involvedNodeIds = new Set<string>();
    for (const edge of folderEdges) {
        involvedNodeIds.add(edge.source);
        involvedNodeIds.add(edge.target);
    }

    // Also include nodes that are physically in the folder (even if disconnected/no edges)
    const prefix = folderPath.replace(/\\/g, '/');
    const folderNodes = allNodes.filter(n => {
        if (involvedNodeIds.has(n.id)) return true;
        const normalizedFile = n.fileId.replace(/\\/g, '/');
        return normalizedFile.startsWith(prefix.endsWith('/') ? prefix : prefix + '/');
    });

    // Generate Markdown Summary
    const lines: string[] = [];
    lines.push(`### FOLDER GRAPH: ${folderPath}`);
    lines.push('');

    // 1. Files & Entities
    const fileNodes = folderNodes.filter(n => n.kind === 'file');
    lines.push(`#### FILES (${fileNodes.length})`);

    // Group entities by file for clarity
    const filesMap = new Map<string, NodeEntry[]>();
    for (const node of folderNodes) {
        if (node.kind === 'file') continue;
        if (!filesMap.has(node.fileId)) filesMap.set(node.fileId, []);
        filesMap.get(node.fileId)!.push(node);
    }

    if (fileNodes.length === 0) {
        lines.push('(none found in graph)');
    } else {
        const sortedFiles = Array.from(filesMap.keys()).sort();
        for (const fileId of sortedFiles) {
            const entities = filesMap.get(fileId) || [];
            lines.push(`- **${fileId}**`);
            entities.forEach(e => {
                lines.push(`  - \`${e.name}\` (${e.kind})`);
            });
        }
    }
    lines.push('');

    // 2. Imports (External Dependencies)
    lines.push('#### IMPORTS (External)');
    const importEdges = filterImportEdges(getImportEdges(folderEdges));

    const uniqueImports = new Set<string>();

    const isInternal = (p: string) => {
        const normalized = p.replace(/\\/g, '/');
        return normalized.startsWith(prefix.endsWith('/') ? prefix : prefix + '/');
    };

    for (const edge of importEdges) {
        const target = edge.target;
        if (!isInternal(target)) {
            const sourceFile = path.basename(edge.source);
            uniqueImports.add(`${sourceFile} → ${target}`);
        }
    }

    if (uniqueImports.size === 0) {
        lines.push('(none)');
    } else {
        Array.from(uniqueImports).sort().forEach(i => lines.push(`- ${i}`));
    }
    lines.push('');

    // 3. Calls
    lines.push('#### CALLS');
    const callEdges = getCallEdges(folderEdges);

    const internalCalls: string[] = [];
    const outgoingCalls: string[] = [];
    const incomingCalls: string[] = [];

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

    for (const edge of callEdges) {
        const source = edge.source;
        const target = edge.target;

        let sourceFile = source;
        if (source.includes('::')) sourceFile = source.split('::')[0];

        let targetFile = target;
        if (target.includes('::')) targetFile = target.split('::')[0];

        const targetName = target.includes('::') ? target.split('::').pop()! : target;
        if (stdlibFunctions.has(targetName)) continue;

        const sourceIn = isInternal(sourceFile);
        const targetIn = isInternal(targetFile);

        const sourceName = source.includes('::') ? source.split('::').pop()! : path.basename(source);

        const edgeStr = `${sourceName} → ${targetName}`;

        if (sourceIn && targetIn) {
            internalCalls.push(edgeStr);
        } else if (sourceIn && !targetIn) {
            outgoingCalls.push(`${sourceName} → ${targetFile}:${targetName}`);
        } else if (!sourceIn && targetIn) {
            incomingCalls.push(`${sourceFile}:${sourceName} → ${targetName}`);
        }
    }

    lines.push('**Internal Interactions**');
    if (internalCalls.length === 0) lines.push('- (none)');
    else Array.from(new Set(internalCalls)).sort().forEach(c => lines.push(`- ${c}`));
    lines.push('');

    lines.push('**Outgoing Calls (Dependencies)**');
    if (outgoingCalls.length === 0) lines.push('- (none)');
    else Array.from(new Set(outgoingCalls)).sort().forEach(c => lines.push(`- ${c}`));
    lines.push('');

    lines.push('**Incoming Calls (Usage)**');
    if (incomingCalls.length === 0) lines.push('- (none)');
    else Array.from(new Set(incomingCalls)).sort().forEach(c => lines.push(`- ${c}`));
    lines.push('');

    const readmePath = path.join(rootDir, '.arch', folderPath, 'README.md');

    return {
        folderPath,
        rootDir,
        readmePath,
        markdown: lines.join('\n'),
        rawEdges: folderEdges,
        stats: {
            files: fileNodes.length,
            nodes: folderNodes.length,
            edges: folderEdges.length
        },
        existingDocs
    };
}

/**
 * Build the enrichment prompt for the LLM
 */
export function buildFolderEnrichmentPrompt(
    folderPath: string,
    data: FolderInfoMcpData
): string {
    const importEdgeLines = data.rawEdges
        .filter(e => e.kind === 'import')
        .map(e => `  ${e.source} → ${e.target}`)
        .join('\n');

    const callEdgeLines = data.rawEdges
        .filter(e => e.kind === 'call')
        .map(e => `  ${e.source} → ${e.target}`)
        .join('\n');

    // Include existing documentation if present
    const existingDocsSection = data.existingDocs
        ? `## EXISTING DOCUMENTATION
The following documentation already exists for this folder. Please verify and update it based on the graph data above:

\`\`\`markdown
${data.existingDocs}
\`\`\`

---

`
        : '';

    return `# FOLDER DOCUMENTATION TASK

## OBJECTIVE
Create a comprehensive **Folder Overview** for: \`${folderPath}\`.

## STATISTICS
- **Total Files:** ${data.stats.files}
- **Graph Nodes:** ${data.stats.nodes}
- **Graph Edges:** ${data.stats.edges}

## STRUCTURAL ANALYSIS (Graph)
${data.markdown}

## IMPORTS (relevant to this folder)
\`\`\`
${importEdgeLines || '(none)'}
\`\`\`

## FUNCTION CALLS (relevant to this folder)
\`\`\`
${callEdgeLines || '(none)'}
\`\`\`

---

${existingDocsSection}## YOUR TASK
Synthesize the above information into a comprehensive folder overview.

### Required Analysis:
1. **Folder Purpose:** What is the core responsibility of this folder?
2. **Internal Coupling:** How tightly connected are the files? Which are the central/hub files?
3. **External Dependencies:** What does this folder rely on? Categorize by type (Node.js built-ins, npm packages, internal folders).
4. **Public Interface:** What functions/classes are exported and used by other folders?
5. **Data Flow:** How does data flow through this folder? What transformations occur?
6. **Implementation Details:** Highlight important patterns, algorithms, or design decisions.

## OUTPUT FORMAT
Call the \`report_folder_info\` tool with the following structure:

\`\`\`json
{
  "path": "${folderPath}",
  "overview": "<2-3 paragraph description of folder purpose, responsibilities, and role in the codebase>",
  "inputs": "<Detailed list of external dependencies with their purpose>",
  "outputs": "<List of key exports/public APIs with brief descriptions>",
  "key_files": [
    { "name": "<filename>", "summary": "<2-3 sentence summary including key functions/classes>" }
  ],
  "architecture": "<Detailed description of internal structure, data flow patterns, and important implementation details>"
}
\`\`\`

---

## POST-SAVE STEP (REQUIRED)

Due to a workspace root detection issue, the \`report_folder_info\` tool saves the document to the wrong location. After calling \`report_folder_info\`, you **MUST** copy the generated content to the correct user workspace path:

**Correct path:** \`.arch/${folderPath}/README.md\` (relative to the user's project root)

Use your file writing tools to create this file with the design document content returned by the tool.
`;
}
