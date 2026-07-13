/**
 * Folder enrichment-prompt + README renderers (Loop 14 extraction of
 * `application/document-folder.ts`).
 *
 * `renderEnrichmentPrompt` builds the LLM task prompt from the structural
 * markdown + raw edges + stats; `renderFolderReadme` formats the LLM's
 * enrichment payload into the `.llmem/docs/{folder}/README.md` design document.
 * Both are pure string builders.
 */

import type { EdgeEntry } from '../../graph/edgelist';
import type { ScanCoverage } from '../scan';
import { renderHeuristicCallCaveat } from '../coverage-caveat';
import type { EnrichedFolderKeyFile } from './types';

export function renderEnrichmentPrompt(
    folderPath: string,
    structuralMarkdown: string,
    rawEdges: EdgeEntry[],
    stats: { files: number; nodes: number; edges: number },
    existingDocs: string | null,
    coverage?: ScanCoverage,
): string {
    const importEdgeLines = rawEdges
        .filter((e) => e.kind === 'import')
        .map((e) => `  ${e.source} → ${e.target}`)
        .join('\n');

    const callEdgeLines = rawEdges
        .filter((e) => e.kind === 'call')
        .map((e) => `  ${e.source} → ${e.target}`)
        .join('\n');

    const existingDocsSection = existingDocs
        ? `## EXISTING DOCUMENTATION
The following documentation already exists for this folder. Please verify and update it based on the graph data above:

\`\`\`markdown
${existingDocs}
\`\`\`

---

`
        : '';

    // PC-03: when the folder contains heuristic-call-graph (Python) files,
    // emit a single caveat line right under the FUNCTION CALLS block so the
    // LLM does not read missing Python call edges as "loose coupling".
    // Empty (no trailing newline) for pure-semantic folders → no noise.
    const heuristicCaveat = renderHeuristicCallCaveat(coverage);
    const heuristicCaveatLine = heuristicCaveat ? `\n> ${heuristicCaveat}\n` : '';

    return `# FOLDER DOCUMENTATION TASK

## OBJECTIVE
Create a comprehensive **Folder Overview** for: \`${folderPath}\`.

## STATISTICS
- **Total Files:** ${stats.files}
- **Graph Nodes:** ${stats.nodes}
- **Graph Edges:** ${stats.edges}

## STRUCTURAL ANALYSIS (Graph)
${structuralMarkdown}

## IMPORTS (relevant to this folder)
\`\`\`
${importEdgeLines || '(none)'}
\`\`\`

## FUNCTION CALLS (relevant to this folder)
\`\`\`
${callEdgeLines || '(none)'}
\`\`\`
${heuristicCaveatLine}
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
`;
}

export interface FolderReadmeInput {
    folderPath: string;
    overview: string;
    inputs?: string;
    outputs?: string;
    keyFiles: EnrichedFolderKeyFile[];
    architecture: string;
}

export function renderFolderReadme(input: FolderReadmeInput): string {
    const { folderPath, overview, inputs, outputs, keyFiles, architecture } = input;
    const lines: string[] = [];

    lines.push(`# FOLDER: ${folderPath}`);
    lines.push('');
    lines.push('## Overview');
    lines.push(overview);
    lines.push('');

    if (inputs) lines.push(`**Inputs:** ${inputs}\n`);
    if (outputs) lines.push(`**Outputs:** ${outputs}\n`);

    lines.push('## Architecture');
    lines.push(architecture);
    lines.push('');

    lines.push('## Key Files');
    for (const file of keyFiles) {
        lines.push(`- **${file.name}**: ${file.summary}`);
    }

    return lines.join('\n');
}
