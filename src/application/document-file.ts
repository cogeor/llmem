/**
 * Document-file service. Application-layer entry point for the
 * `file_info` / `report_file_info` MCP workflow.
 *
 * Loop 07 lifts this from `src/info/mcp.ts`. The function names above
 * (`getFileInfoForMcp`, `processFileInfoReport`, `buildEnrichmentPrompt`)
 * have been renamed at the application surface to reflect the layer:
 *   - `buildDocumentFilePrompt` (combined extraction + prompt building)
 *   - `processFileInfoReport`   (writes the LLM-enriched markdown)
 *
 * Boundary discipline:
 *   - Every entry point takes a branded `WorkspaceRoot` AND a
 *     `WorkspaceIO` constructed from it. No call into `getWorkspaceRoot()`
 *     or `process.cwd()` from inside this module.
 *   - All filesystem access goes through `workspace/workspace-io`
 *     (realpath-strong containment; L25).
 *   - No imports from `src/artifact/` (deprecated; Loop 17 retires it).
 *   - The README "Known Issue" workaround that used to live in the
 *     legacy prompt template (a final section telling the agent to copy
 *     files manually) has been removed. The proper fix is the
 *     workspace-root threading; the workaround was actively harmful.
 */

import * as path from 'path';
import { artifactToEdgeList } from '../graph/artifact-converter';
import { ParserRegistry } from '../parser/registry';
import { getLanguageFromPath } from '../parser/config';
import { parseGraphId } from '../core/ids';
import type { WorkspaceRoot, AbsPath, RelPath } from '../core/paths';
import type { Logger } from '../core/logger';
import { WorkspaceIO } from '../workspace/workspace-io';
import { getFileArchPath } from '../docs/arch-store';
import { extractFileInfo } from '../info/extractor';
import { getImportEdges, getCallEdges, filterImportEdges } from '../info/filter';
import type { FileInfo } from '../info/types';

// ============================================================================
// Public types
// ============================================================================

/**
 * Enriched function data from the LLM.
 */
export interface EnrichedFunction {
    name: string;
    purpose: string;
    implementation: string;
}

/**
 * LLM enrichment payload for a single file.
 */
export interface EnrichedFileData {
    path: string;
    overview: string;
    inputs?: string;
    outputs?: string;
    functions: EnrichedFunction[];
}

export interface DocumentFileRequest {
    workspaceRoot: WorkspaceRoot;
    filePath: RelPath;
    /** Required (L25): realpath-strong I/O surface anchored on workspaceRoot. */
    io: WorkspaceIO;
    logger?: Logger;
}

export interface DocumentFileData {
    /** Source-relative path (forward slashes). */
    filePath: RelPath;
    /** Workspace root used for all path resolution. */
    rootDir: WorkspaceRoot;
    /** Absolute path to the .arch/{path}.md target. */
    archPath: AbsPath;
    /** Prompt for the host LLM (full design-doc generation prompt). */
    prompt: string;
    /** Auto-extracted structural summary (imports, entities, call edges). */
    structuralMarkdown: string;
    /** FileInfo (functions, classes) for downstream rendering. */
    info: FileInfo;
    /** Source code that was read. */
    sourceCode: string;
}

export interface ReportFileInfoRequest {
    workspaceRoot: WorkspaceRoot;
    filePath: RelPath;
    overview: string;
    inputs?: string;
    outputs?: string;
    functions: EnrichedFunction[];
    /** Required (L25): realpath-strong I/O surface anchored on workspaceRoot. */
    io: WorkspaceIO;
    logger?: Logger;
}

export interface ReportFileInfoResult {
    archPath: AbsPath;
    bytesWritten: number;
    designDocument: string;
}

// ============================================================================
// buildDocumentFilePrompt
// ============================================================================

/**
 * Read a source file, extract structure via the parser registry, and
 * build the LLM prompt that drives report_file_info.
 *
 * Replaces the legacy `getFileInfoForMcp` + `buildEnrichmentPrompt`
 * pair. Workspace root is supplied by the caller; this function does
 * not call `process.cwd()` or any deprecated artifact helper.
 */
export async function buildDocumentFilePrompt(
    req: DocumentFileRequest,
): Promise<DocumentFileData> {
    const { workspaceRoot, filePath, io } = req;

    // Read source via WorkspaceIO (realpath-strong containment).
    // WorkspaceIO.readFile does NOT swallow ENOENT — translate it
    // explicitly to preserve the original error message.
    let sourceCode: string;
    try {
        sourceCode = await io.readFile(filePath);
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
            throw new Error(`File not found: ${filePath}`);
        }
        throw err;
    }

    // Resolve absolute path for parser-side reads. The parser API takes
    // an absolute path; the read above already verified the file exists.
    const absolutePath = path.join(workspaceRoot, filePath);

    const registry = ParserRegistry.getInstance();
    const parser = registry.getParser(filePath, workspaceRoot);
    if (!parser) {
        const ext = path.extname(filePath);
        throw new Error(
            `Unsupported file type: ${ext}. Supported extensions: ` +
            `${registry.getSupportedExtensions().join(', ')}`,
        );
    }

    const artifact = await parser.extract(absolutePath);
    if (!artifact) {
        throw new Error(`Failed to extract artifact from ${filePath}`);
    }

    const { nodes, importEdges: rawImportEdges, callEdges: rawCallEdges } =
        artifactToEdgeList(artifact, filePath);

    const importEdges = filterImportEdges(getImportEdges(rawImportEdges));
    const callEdges = getCallEdges(rawCallEdges);

    // Build the structural markdown summary (imports + entities + call edges).
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
    const entityNodes = nodes.filter((n) => n.kind !== 'file');
    if (entityNodes.length === 0) {
        lines.push('(none)');
    } else {
        for (const node of entityNodes) {
            const entity = artifact.entities.find((e) => e.name === node.name);
            const exportMark = entity?.isExported ? ' [exported]' : '';
            const sig = entity?.signature ? ` - \`${entity.signature}\`` : '';
            lines.push(`- **${node.name}** (${node.kind})${exportMark}${sig}`);
        }
    }
    lines.push('');

    lines.push('### CALL EDGES');
    const filteredCallEdges = callEdges.filter((edge) => {
        const parsed = parseGraphId(edge.target);
        const targetName = parsed.kind === 'entity' ? parsed.name : edge.target;
        return !STDLIB_FUNCTIONS.has(targetName);
    });

    if (filteredCallEdges.length === 0) {
        lines.push('(none)');
    } else {
        for (const edge of filteredCallEdges) {
            const sourceParsed = parseGraphId(edge.source);
            const targetParsed = parseGraphId(edge.target);

            const sourceName = sourceParsed.kind === 'entity' ? sourceParsed.name : edge.source;
            const targetFile = targetParsed.kind === 'entity' ? targetParsed.fileId : edge.target;
            const targetName = targetParsed.kind === 'entity' ? targetParsed.name : edge.target;

            if (targetFile === filePath) {
                lines.push(`- ${sourceName} → ${targetName}`);
            } else {
                lines.push(`- ${sourceName} → ${targetFile}:${targetName}`);
            }
        }
    }

    const structuralMarkdown = lines.join('\n');
    const info: FileInfo = extractFileInfo(filePath, artifact, new Map());
    const archPath = getFileArchPath(workspaceRoot, filePath);

    const prompt = renderEnrichmentPrompt(filePath, structuralMarkdown, sourceCode);

    return {
        filePath,
        rootDir: workspaceRoot,
        archPath,
        prompt,
        structuralMarkdown,
        info,
        sourceCode,
    };
}

// ============================================================================
// processFileInfoReport
// ============================================================================

/**
 * Persist the LLM's enrichment for a file into .arch/{path}.md.
 *
 * The branded `workspaceRoot` is the only source of truth for the
 * destination — `process.cwd()` is never consulted. This is the
 * regression fix for the README "Known Issue" workaround that the
 * legacy prompt told the agent to apply manually.
 */
export async function processFileInfoReport(
    req: ReportFileInfoRequest,
): Promise<ReportFileInfoResult> {
    const { workspaceRoot, filePath, overview, inputs, outputs, functions, io } = req;

    const designDocument = renderDesignDocument({
        filePath,
        overview,
        inputs,
        outputs,
        functions,
    });

    const archPath = getFileArchPath(workspaceRoot, filePath);

    // Compute the workspace-relative path against the realpath of the
    // workspace root (handles macOS /var → /private/var, Windows short
    // paths, etc). WorkspaceIO.writeFile does NOT auto-mkdir, so we
    // explicitly mkdir-recursive the parent first.
    const archRel = path.relative(io.getRealRoot(), archPath).replace(/\\/g, '/');
    await io.mkdirRecursive(path.dirname(archRel));
    await io.writeFile(archRel, designDocument);

    return {
        archPath,
        bytesWritten: Buffer.byteLength(designDocument, 'utf-8'),
        designDocument,
    };
}

// ============================================================================
// Internal: prompt template
// ============================================================================

function renderEnrichmentPrompt(
    filePath: string,
    fileInfoMarkdown: string,
    sourceCode: string,
): string {
    const lineCount = sourceCode.split('\n').length;
    const language = getLanguageFromPath(filePath);

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

// ============================================================================
// Internal: design-document renderer (used by processFileInfoReport)
// ============================================================================

interface DesignDocumentInput {
    filePath: string;
    overview: string;
    inputs?: string;
    outputs?: string;
    functions: EnrichedFunction[];
}

function renderDesignDocument(input: DesignDocumentInput): string {
    const { filePath, overview, inputs, outputs, functions } = input;
    const lines: string[] = [];

    lines.push(`# DESIGN DOCUMENT: ${filePath}`);
    lines.push('');
    lines.push(
        '> **Instructions:** This document serves as a blueprint for implementing the source code. ' +
        'Review the specifications below before writing code.',
    );
    lines.push('');
    lines.push('---');
    lines.push('');

    lines.push('## FILE OVERVIEW');
    lines.push('');
    lines.push(overview);
    lines.push('');

    if (inputs) {
        lines.push(`**Inputs:** ${inputs}`);
        lines.push('');
    }
    if (outputs) {
        lines.push(`**Outputs:** ${outputs}`);
        lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push('## FUNCTION SPECIFICATIONS');
    lines.push('');

    for (const func of functions) {
        lines.push(`### \`${func.name}\``);
        lines.push('');
        lines.push(`**Purpose:** ${func.purpose}`);
        lines.push('');
        lines.push('**Implementation:**');
        lines.push('');
        lines.push(func.implementation);
        lines.push('');
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
