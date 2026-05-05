/**
 * Document-folder service. Application-layer entry point for the
 * `folder_info` / `report_folder_info` MCP workflow.
 *
 * Loop 08 lifts this from `src/info/folder.ts`. The legacy function
 * names (`getFolderInfoForMcp`, `buildFolderEnrichmentPrompt`,
 * `loadExistingFolderReadme`) collapse into two application-layer
 * entries that mirror Loop 07's document-file shape:
 *   - `buildDocumentFolderPrompt` (combined extraction + prompt building)
 *   - `processFolderInfoReport`   (writes the LLM-enriched README)
 *
 * Boundary discipline (mirrors Loop 07):
 *   - Every entry point takes a branded `WorkspaceRoot` AND a
 *     `WorkspaceIO` constructed from it. No call into `getWorkspaceRoot()`
 *     or `process.cwd()` from inside this module.
 *   - All filesystem access goes through `workspace/workspace-io`
 *     (realpath-strong containment; L25). No direct `fs` imports.
 *   - No imports from `src/artifact/` (deprecated; Loop 17 retires it).
 *   - The README "Known Issue" workaround that used to live in the
 *     legacy folder prompt template (a final "post-save" instruction
 *     telling the agent to copy the saved README manually) has been
 *     removed. The proper fix is workspace-root threading; the
 *     workaround was actively harmful.
 *
 * The artifacts directory (.artifacts/import-edgelist.json /
 * call-edgelist.json) is read directly via the edge-list stores. The
 * folder analysis is a pure projection over those stores plus the
 * filtering helpers in `src/info/filter.ts`.
 */

import * as path from 'path';
import { ImportEdgeListStore, CallEdgeListStore, NodeEntry, EdgeEntry } from '../graph/edgelist';
import { getImportEdges, getCallEdges, filterImportEdges, getEdgesForModule } from '../info/filter';
import { parseGraphId } from '../core/ids';
import type { WorkspaceRoot, AbsPath, RelPath } from '../core/paths';
import { getFolderArchPath } from '../docs/arch-store';
import type { WorkspaceContext } from './workspace-context';

// ============================================================================
// Public types
// ============================================================================

/**
 * One key file entry in the LLM enrichment payload.
 */
export interface EnrichedFolderKeyFile {
    name: string;
    summary: string;
}

/**
 * LLM enrichment payload for a folder.
 */
export interface EnrichedFolderData {
    path: string;
    overview: string;
    inputs?: string;
    outputs?: string;
    key_files: EnrichedFolderKeyFile[];
    architecture: string;
}

/** Per-call request fields for `buildDocumentFolderPrompt`. */
export interface DocumentFolderRequest {
    folderPath: RelPath;
}

export interface DocumentFolderData {
    /** Folder-relative path (forward slashes). */
    folderPath: RelPath;
    /** Workspace root used for all path resolution. */
    rootDir: WorkspaceRoot;
    /** Absolute path to the .arch/{folder}/README.md target. */
    readmePath: AbsPath;
    /** Prompt for the host LLM (full folder-overview generation prompt). */
    prompt: string;
    /** Auto-extracted structural summary (files, imports, calls). */
    structuralMarkdown: string;
    /** Existing .arch README contents, if any. */
    existingDocs: string | null;
    /** Raw edges relevant to the folder (for diagnostics / future use). */
    rawEdges: EdgeEntry[];
    stats: {
        files: number;
        nodes: number;
        edges: number;
    };
}

/** Per-call request fields for `processFolderInfoReport`. */
export interface ReportFolderInfoRequest {
    folderPath: RelPath;
    overview: string;
    inputs?: string;
    outputs?: string;
    keyFiles: EnrichedFolderKeyFile[];
    architecture: string;
}

export interface ReportFolderInfoResult {
    readmePath: AbsPath;
    bytesWritten: number;
    designDocument: string;
}

// ============================================================================
// buildDocumentFolderPrompt
// ============================================================================

/**
 * Read folder structural data (files, imports, calls) from the edge-list
 * stores and build the LLM prompt that drives report_folder_info.
 *
 * Replaces the legacy `getFolderInfoForMcp` + `buildFolderEnrichmentPrompt`
 * pair. Workspace root is supplied by the caller; this function does
 * not call `process.cwd()` or any deprecated artifact helper.
 */
export async function buildDocumentFolderPrompt(
    ctx: WorkspaceContext,
    req: DocumentFolderRequest,
): Promise<DocumentFolderData> {
    const { workspaceRoot, io } = ctx;
    const { folderPath } = req;

    // Confirm the folder exists. WorkspaceIO.exists returns false on
    // ENOENT/ENOTDIR but throws PathEscapeError on textual escape, so
    // path-traversal attempts surface rather than silently returning false.
    if (!(await io.exists(folderPath))) {
        throw new Error(`Folder not found: ${folderPath}`);
    }

    // Load existing .arch/<folder>/README.md if present.
    const readmePath = getFolderArchPath(workspaceRoot, folderPath);
    const readmeRel = path.relative(io.getRealRoot(), readmePath).replace(/\\/g, '/');
    let existingDocs: string | null = null;
    try {
        existingDocs = await io.readFile(readmeRel);
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') throw err;
        // ENOENT → leave existingDocs null (the prompt template handles it).
    }

    // Load graphs from .artifacts (split stores). The artifact directory
    // currently lives at the conventional `.artifacts` location relative
    // to the workspace root; the configurable `artifactRoot` setting is
    // an extension-side concern and is plumbed through the MCP tool
    // boundary. TODO(Loop 09): replace this hardcoded `.artifacts` with
    // `ctx.artifactRoot` once `DocumentFolderRequest` is allowed to carry
    // the artifactRoot through (see PLAN out-of-scope §
    // DocumentFolderRequest). For Loop 04 we preserve the legacy default
    // (computed from `ctx.workspaceRoot`) to minimize behavior drift.
    const artifactDir = path.join(workspaceRoot, '.artifacts');
    const artifactRel = path.relative(io.getRealRoot(), artifactDir).replace(/\\/g, '/');
    if (!(await io.exists(artifactRel))) {
        throw new Error(
            `Artifacts directory not found at ${artifactDir}. ` +
            `Please run 'npm run scan' first.`,
        );
    }

    const importStore = new ImportEdgeListStore(artifactDir, io);
    const callStore = new CallEdgeListStore(artifactDir, io);
    await importStore.load();
    await callStore.load();

    const allImportEdges = importStore.getEdges();
    const allCallEdges = callStore.getEdges();
    const allEdges = [...allImportEdges, ...allCallEdges];
    const allNodes = [...importStore.getNodes(), ...callStore.getNodes()];

    // Filter edges for this folder (recursive to include subfolders).
    const folderEdges = getEdgesForModule(allEdges, folderPath, true);

    // Collect nodes: those involved in folder edges plus any physically
    // inside the folder (covers disconnected files).
    const involvedNodeIds = new Set<string>();
    for (const edge of folderEdges) {
        involvedNodeIds.add(edge.source);
        involvedNodeIds.add(edge.target);
    }

    const prefix = folderPath.replace(/\\/g, '/');
    const folderNodes = allNodes.filter((n) => {
        if (involvedNodeIds.has(n.id)) return true;
        const normalizedFile = n.fileId.replace(/\\/g, '/');
        return normalizedFile.startsWith(prefix.endsWith('/') ? prefix : prefix + '/');
    });

    const structuralMarkdown = renderStructuralMarkdown({
        folderPath,
        folderNodes,
        folderEdges,
        prefix,
    });

    const fileNodeCount = folderNodes.filter((n) => n.kind === 'file').length;
    const stats = {
        files: fileNodeCount,
        nodes: folderNodes.length,
        edges: folderEdges.length,
    };

    const prompt = renderEnrichmentPrompt(
        folderPath,
        structuralMarkdown,
        folderEdges,
        stats,
        existingDocs,
    );

    return {
        folderPath,
        rootDir: workspaceRoot,
        readmePath,
        prompt,
        structuralMarkdown,
        existingDocs,
        rawEdges: folderEdges,
        stats,
    };
}

// ============================================================================
// processFolderInfoReport
// ============================================================================

/**
 * Persist the LLM's enrichment for a folder into .arch/{folder}/README.md.
 *
 * The branded `workspaceRoot` is the only source of truth for the
 * destination — `process.cwd()` is never consulted. This is the
 * regression fix for the README "Known Issue" workaround that the
 * legacy folder prompt told the agent to apply manually.
 */
export async function processFolderInfoReport(
    ctx: WorkspaceContext,
    req: ReportFolderInfoRequest,
): Promise<ReportFolderInfoResult> {
    const { workspaceRoot, io } = ctx;
    const { folderPath, overview, inputs, outputs, keyFiles, architecture } = req;

    const designDocument = renderFolderReadme({
        folderPath,
        overview,
        inputs,
        outputs,
        keyFiles,
        architecture,
    });

    const readmePath = getFolderArchPath(workspaceRoot, folderPath);

    // Compute the workspace-relative path against the realpath of the
    // workspace root. WorkspaceIO.writeFile does NOT auto-mkdir, so we
    // explicitly mkdir-recursive the parent first.
    const readmeRel = path.relative(io.getRealRoot(), readmePath).replace(/\\/g, '/');
    await io.mkdirRecursive(path.dirname(readmeRel));
    await io.writeFile(readmeRel, designDocument);

    return {
        readmePath,
        bytesWritten: Buffer.byteLength(designDocument, 'utf-8'),
        designDocument,
    };
}

// ============================================================================
// Internal: structural markdown renderer
// ============================================================================

interface StructuralMarkdownInput {
    folderPath: string;
    folderNodes: NodeEntry[];
    folderEdges: EdgeEntry[];
    prefix: string;
}

function renderStructuralMarkdown(input: StructuralMarkdownInput): string {
    const { folderPath, folderNodes, folderEdges, prefix } = input;
    const lines: string[] = [];

    lines.push(`### FOLDER GRAPH: ${folderPath}`);
    lines.push('');

    // 1. Files & Entities
    const fileNodes = folderNodes.filter((n) => n.kind === 'file');
    lines.push(`#### FILES (${fileNodes.length})`);

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
            entities.forEach((e) => {
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
        Array.from(uniqueImports).sort().forEach((i) => lines.push(`- ${i}`));
    }
    lines.push('');

    // 3. Calls
    lines.push('#### CALLS');
    const callEdges = getCallEdges(folderEdges);

    const internalCalls: string[] = [];
    const outgoingCalls: string[] = [];
    const incomingCalls: string[] = [];

    for (const edge of callEdges) {
        const source = edge.source;
        const target = edge.target;

        const sourceParsed = parseGraphId(source);
        const targetParsed = parseGraphId(target);

        const sourceFile = sourceParsed.kind === 'entity' ? sourceParsed.fileId : source;
        const targetFile = targetParsed.kind === 'entity' ? targetParsed.fileId : target;
        const targetName = targetParsed.kind === 'entity' ? targetParsed.name : target;
        const sourceName = sourceParsed.kind === 'entity' ? sourceParsed.name : path.basename(source);

        if (STDLIB_FUNCTIONS.has(targetName)) continue;

        const sourceIn = isInternal(sourceFile);
        const targetIn = isInternal(targetFile);

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
    else Array.from(new Set(internalCalls)).sort().forEach((c) => lines.push(`- ${c}`));
    lines.push('');

    lines.push('**Outgoing Calls (Dependencies)**');
    if (outgoingCalls.length === 0) lines.push('- (none)');
    else Array.from(new Set(outgoingCalls)).sort().forEach((c) => lines.push(`- ${c}`));
    lines.push('');

    lines.push('**Incoming Calls (Usage)**');
    if (incomingCalls.length === 0) lines.push('- (none)');
    else Array.from(new Set(incomingCalls)).sort().forEach((c) => lines.push(`- ${c}`));
    lines.push('');

    return lines.join('\n');
}

// ============================================================================
// Internal: prompt template
// ============================================================================

function renderEnrichmentPrompt(
    folderPath: string,
    structuralMarkdown: string,
    rawEdges: EdgeEntry[],
    stats: { files: number; nodes: number; edges: number },
    existingDocs: string | null,
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

// ============================================================================
// Internal: README renderer (used by processFolderInfoReport)
// ============================================================================

interface FolderReadmeInput {
    folderPath: string;
    overview: string;
    inputs?: string;
    outputs?: string;
    keyFiles: EnrichedFolderKeyFile[];
    architecture: string;
}

function renderFolderReadme(input: FolderReadmeInput): string {
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

// ============================================================================
// Constants
// ============================================================================

const STDLIB_FUNCTIONS: ReadonlySet<string> = new Set([
    'push', 'pop', 'shift', 'unshift', 'splice', 'slice', 'concat',
    'map', 'filter', 'reduce', 'forEach', 'find', 'findIndex', 'some', 'every',
    'includes', 'indexOf', 'join', 'split', 'trim', 'replace', 'match',
    'toString', 'valueOf', 'hasOwnProperty',
    'get', 'set', 'has', 'delete', 'clear', 'add', 'keys', 'values', 'entries',
    'next', 'done', 'then', 'catch', 'finally',
    'log', 'error', 'warn', 'info', 'debug',
    'Map', 'Set', 'Promise', 'Error', 'JSON', 'Object', 'Array',
]);
