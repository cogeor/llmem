/**
 * Document-file service entry points (Loop 12 extraction of
 * `application/document-file.ts`).
 *
 * `buildDocumentFilePrompt` (combined extraction + prompt building) and
 * `processFileInfoReport` (writes the LLM-enriched markdown) are the two
 * application-layer entries for the `file_info` / `report_file_info`
 * MCP workflow.
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
import { ParserRegistry } from '../../parser/registry';
import type { WorkspaceContext } from '../workspace-context';
import { getFileArchPath } from '../../docs/arch-store';
import { extractFileInfo } from '../file-info';
import type { FileInfo } from '../file-info';
import { refreshFileGraph } from '../refresh-graph';
import { renderCoverageCaveat } from '../coverage-caveat';
import type {
    DocumentFileRequest,
    DocumentFileData,
    ReportFileInfoRequest,
    ReportFileInfoResult,
} from './types';
import { renderStructuralMarkdown } from './file-projection';
import { renderEnrichmentPrompt, renderDesignDocument } from './file-prompt';

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
    ctx: WorkspaceContext,
    req: DocumentFileRequest,
): Promise<DocumentFileData> {
    const { workspaceRoot, io } = ctx;
    const { filePath, refresh } = req;

    // LS-08: bring THIS file's edges up to date as a side effect, mirroring
    // the folder path's refreshFolderGraph (LS-06). On a never-scanned file
    // this populates the stores + manifest; on a warm file it is stat + a
    // manifest fingerprint compare only (no re-parse). The returned
    // ScanCoverage drives the §7 caveat appended below. Run BEFORE the inline
    // extract so a gate-skipped file still surfaces a caveat.
    //
    // DOUBLE-PARSE (perf follow-up): the inline parser.extract below also
    // parses this file to build the prompt's structural markdown, so a
    // cold/changed file is parsed twice in one call. Reconciling is invasive
    // (the inline extract drives the exact prompt shape the tests assert), so
    // the second parse is accepted; warm calls do not re-parse in refresh, so
    // steady-state file_info pays a single parse.
    const refreshCoverage = await refreshFileGraph(ctx, { filePath, refresh });

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

    const structuralMarkdown = renderStructuralMarkdown(filePath, artifact);
    const info: FileInfo = extractFileInfo(filePath, artifact, new Map());
    const archPath = getFileArchPath(workspaceRoot, filePath);

    let prompt = renderEnrichmentPrompt(filePath, structuralMarkdown, sourceCode);

    // LS-08 + LS-04: append the §7 coverage caveat when the refresh dropped
    // this file by a gate (denylist / size / lines). Reuses the SHARED
    // renderCoverageCaveat helper from ../coverage-caveat — same wording. Returns
    // '' for a clean coverage, so a normal file leaves the prompt unchanged
    // (the prompt shape the tests assert is preserved).
    const caveat = renderCoverageCaveat(refreshCoverage, {
        maxFileSizeKB: ctx.config.maxFileSizeKB,
        maxFileLines: ctx.config.maxFileLines,
    });
    if (caveat) prompt = `${prompt}\n${caveat}\n`;

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
    ctx: WorkspaceContext,
    req: ReportFileInfoRequest,
): Promise<ReportFileInfoResult> {
    const { workspaceRoot, io } = ctx;
    const { filePath, overview, inputs, outputs, functions } = req;

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
