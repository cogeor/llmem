/**
 * Module Info Extraction and Prompting
 * 
 * Provides functionality to summarize a folder (module) for LLM consumption.
 * Uses the pre-generated split EdgeList graphs (import + call).
 */

import * as fs from 'fs';
import * as path from 'path';
import { ImportEdgeListStore, CallEdgeListStore, NodeEntry, EdgeEntry } from '../graph/edgelist';
import { getImportEdges, getCallEdges, filterImportEdges, getEdgesForModule } from './filter';

/**
 * Data needed for the module info prompt
 */
export interface ModuleInfoMcpData {
    folderPath: string;
    markdown: string;
    rawEdges: EdgeEntry[];
    stats: {
        files: number;
        nodes: number;
        edges: number;
    };
}

/**
 * Get module info data for MCP tool using existing EdgeList
 */
export async function getModuleInfoForMcp(
    rootDir: string,
    folderPath: string
): Promise<ModuleInfoMcpData> {
    const absoluteFolderPath = path.join(rootDir, folderPath);
    if (!fs.existsSync(absoluteFolderPath)) {
        throw new Error(`Folder not found: ${folderPath}`);
    }

    // Load graphs from .artifacts (split stores)
    const artifactDir = path.join(rootDir, '.artifacts');
    if (!fs.existsSync(artifactDir)) {
        throw new Error(`Artifacts directory not found at ${artifactDir}. Please run 'npm run scan' first.`);
    }

    const importStore = new ImportEdgeListStore(artifactDir);
    const callStore = new CallEdgeListStore(artifactDir);
    await importStore.load();
    await callStore.load();

    // Combine edges from both stores for module analysis
    const allImportEdges = importStore.getEdges();
    const allCallEdges = callStore.getEdges();
    const allEdges = [...allImportEdges, ...allCallEdges];

    // Combine nodes (import store has file nodes, call store has entity nodes)
    const allNodes = [...importStore.getNodes(), ...callStore.getNodes()];

    // Filter edges for this module (recursive to include subfolders in the summary as requested)
    const moduleEdges = getEdgesForModule(allEdges, folderPath, true);

    // Identify nodes involved in these edges
    const involvedNodeIds = new Set<string>();
    for (const edge of moduleEdges) {
        involvedNodeIds.add(edge.source);
        involvedNodeIds.add(edge.target);
    }

    // Also include nodes that are physically in the folder (even if disconnected/no edges)
    // This ensures we list all files even if they have no graph activity yet.
    // We filter nodes by fileId starting with folderPath
    const prefix = folderPath.replace(/\\/g, '/');
    const moduleNodes = allNodes.filter(n => {
        if (involvedNodeIds.has(n.id)) return true;
        const normalizedFile = n.fileId.replace(/\\/g, '/');
        // Check if file is in folder (recursive)
        return normalizedFile.startsWith(prefix.endsWith('/') ? prefix : prefix + '/');
    });

    // Generate Markdown Summary
    const lines: string[] = [];
    lines.push(`### MODULE GRAPH: ${folderPath}`);
    lines.push('');

    // 1. Files & Entities
    const fileNodes = moduleNodes.filter(n => n.kind === 'file');
    lines.push(`#### FILES (${fileNodes.length})`);

    // Group entities by file for clarity
    const filesMap = new Map<string, NodeEntry[]>();
    for (const node of moduleNodes) {
        if (node.kind === 'file') continue;
        if (!filesMap.has(node.fileId)) filesMap.set(node.fileId, []);
        filesMap.get(node.fileId)!.push(node);
    }

    if (fileNodes.length === 0) {
        lines.push('(none found in graph)');
    } else {
        // Sort files
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
    const importEdges = filterImportEdges(getImportEdges(moduleEdges));

    const uniqueImports = new Set<string>();

    // Helper to check if a path is internal to the module
    const isInternal = (p: string) => {
        const normalized = p.replace(/\\/g, '/');
        return normalized.startsWith(prefix.endsWith('/') ? prefix : prefix + '/');
    };

    for (const edge of importEdges) {
        const target = edge.target;
        // If target is NOT in the module, it's an external import
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
    const callEdges = getCallEdges(moduleEdges);

    const internalCalls: string[] = [];
    const outgoingCalls: string[] = [];

    // For incoming, we strictly need edges where Target is Internal, Source is External
    // But moduleEdges filter includes edges "involving" the module.
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
        const target = edge.target; // fileId::entity

        let sourceFile = source;
        if (source.includes('::')) sourceFile = source.split('::')[0];

        let targetFile = target;
        if (target.includes('::')) targetFile = target.split('::')[0];

        const targetName = target.includes('::') ? target.split('::').pop()! : target;
        if (stdlibFunctions.has(targetName)) continue;

        const sourceIn = isInternal(sourceFile);
        const targetIn = isInternal(targetFile);

        const sourceName = source.includes('::') ? source.split('::').pop()! : path.basename(source);
        // Clean display names

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

    return {
        folderPath,
        markdown: lines.join('\n'),
        rawEdges: moduleEdges,
        stats: {
            files: fileNodes.length,
            nodes: moduleNodes.length,
            edges: moduleEdges.length
        }
    };
}

/**
 * Build the enrichment prompt for the LLM
 */
export function buildModuleEnrichmentPrompt(
    folderPath: string,
    data: ModuleInfoMcpData
): string {
    // Format raw edges for LLM consumption - separated by type
    const importEdgeLines = data.rawEdges
        .filter(e => e.kind === 'import')
        .map(e => `  ${e.source} → ${e.target}`)
        .join('\n');

    const callEdgeLines = data.rawEdges
        .filter(e => e.kind === 'call')
        .map(e => `  ${e.source} → ${e.target}`)
        .join('\n');

    return `# MODULE DOCUMENTATION TASK

## OBJECTIVE
Create a comprehensive **Module Overview** for the folder: \`${folderPath}\`.

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

## YOUR TASK
Synthesize the above information into a comprehensive module overview.

### Required Analysis:
1. **Module Purpose:** What is the core responsibility of this module?
2. **Internal Coupling:** How tightly connected are the files? Which are the central/hub files?
3. **External Dependencies:** What does this module rely on? Categorize by type (Node.js built-ins, npm packages, internal modules).
4. **Public Interface:** What functions/classes are exported and seemingly used by other modules?
5. **Data Flow:** How does data flow through this module? What transformations occur?
6. **Implementation Details:** Highlight important patterns, algorithms, or design decisions visible in the graph structure.

## OUTPUT FORMAT
Call the \`report_module_info\` tool with the following structure:

\`\`\`json
{
  "path": "${folderPath}",
  "overview": "<2-3 paragraph description of module purpose, responsibilities, and role in the codebase>",
  "inputs": "<Detailed list of external dependencies with their purpose>",
  "outputs": "<List of key exports/public APIs with brief descriptions>",
  "key_files": [
    { "name": "<filename>", "summary": "<2-3 sentence summary including key functions/classes>" }
  ],
  "architecture": "<Detailed description of internal structure, data flow patterns, and important implementation details>"
}
\`\`\`
`;
}
