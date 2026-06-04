/**
 * `scanFile` use-case (loop 07). Extracted from the former monolithic
 * `application/scan.ts` and refactored onto the reusable parser-runner +
 * edge-writer units.
 *
 * Logger discipline: this module MUST NOT call console.*. The `ctx.logger`
 * is used; hosts construct the context with a NoopLogger by default.
 *
 * scanFile is gate-less BY DESIGN: its callers (panel, hot-reload,
 * regenerator, toggle-watch) want "parse this one file" semantics. The LS-03
 * denylist/size/line gates live only in `scanFolder`'s walk (and, for the
 * single-file refresh path, in `refresh-graph.ts`).
 */

import * as path from 'path';
import { CallEdgeListStore, ImportEdgeListStore } from '../../graph/edgelist';
import { ParserRegistry } from '../../parser/registry';
import type { WorkspaceContext } from '../workspace-context';
import type { ScanResult, ScanFileRequest } from './types';
import { emptyCoverage } from './coverage';
import { runParser } from './parser-runner';
import { applyArtifactToStores, loadOrClearOnMismatch } from './edge-writer';

/** Scan a single file and append edges. */
export async function scanFile(
    ctx: WorkspaceContext,
    req: ScanFileRequest,
): Promise<ScanResult> {
    const { workspaceRoot, artifactRoot: artifactDir, io, logger } = ctx;
    const { filePath } = req;

    // L24: io.exists performs textual + realpath containment checks.
    // PathEscapeError surfaces to the caller for `../escape`-style inputs.
    if (!(await io.exists(filePath))) {
        throw new Error(`File not found: ${filePath}`);
    }

    // The parser API takes an absolute path; materialize the canonical
    // realpath form via getRealRoot() + filePath now that containment has
    // been validated.
    const absoluteFile = path.join(io.getRealRoot(), filePath);

    // Load existing edge lists. Loop 07: `io` is the second (mandatory)
    // constructor arg; the edge-list stores' own logger is created
    // internally (their `Logger` shape is `common/logger`'s, not the
    // boundary `core/logger.Logger` accepted by ScanFileOptions /
    // ScanFolderOptions, so we omit it).
    const callStore = new CallEdgeListStore(artifactDir, io);
    const importStore = new ImportEdgeListStore(artifactDir, io);
    // Loop 13 (codebase-quality-v2): a stale edge-list envelope (e.g.
    // pre-resolver-swap `schemaVersion: 1`) raises SchemaMismatchError.
    // The fix is in-place clear() — the in-progress scan then proceeds
    // against a fresh store and `save()` writes a v_next envelope. We
    // do NOT recurse into rescanAfterSchemaMismatch here because the
    // caller is already inside a scan flow.
    await loadOrClearOnMismatch(callStore, importStore, logger);
    const existingCallEdgeCount = callStore.getStats().edges;
    const existingImportEdgeCount = importStore.getStats().edges;

    logger.info(`[GenerateEdges] Processing file: ${filePath}`);
    logger.info(`[GenerateEdges] Existing edges - call: ${existingCallEdgeCount}, import: ${existingImportEdgeCount}`);

    // Get parser from registry (language-agnostic)
    const registry = ParserRegistry.getInstance();

    // runParser instantiates the language extractor, which lazily require()s
    // the tree-sitter native core inside its constructor. If that native
    // addon failed to build/install, the constructor throws — surface it as a
    // ScanResult error entry (not an unhandled crash) with an actionable hint.
    const result = await runParser(registry, logger, {
        rel: filePath,
        absPath: absoluteFile,
        workspaceRoot,
    });

    if (!result.ok && result.kind === 'init-error') {
        const e: any = result.error;
        const fileExt = path.extname(filePath).toLowerCase();
        logger.warn(`[GenerateEdges] Failed to initialize parser for ${filePath}: ${e?.message ?? String(e)}`);
        return {
            filesProcessed: 0,
            filesSkipped: 1,
            errors: [{
                filePath,
                message:
                    `Failed to initialize parser for ${fileExt} (${filePath}): ${e?.message ?? String(e)}. ` +
                    `The tree-sitter native module may be missing or failed to build — ` +
                    `install build tools or a prebuilt binary for your Node version and reinstall.`,
                cause: e,
            }],
            newEdges: 0,
            totalEdges: callStore.getStats().edges,
            unsupportedSourceLikeCounts: {},
            coverage: emptyCoverage(),
        };
    }

    if (!result.ok && result.kind === 'no-parser') {
        const fileExt = path.extname(filePath).toLowerCase();
        logger.warn(`[GenerateEdges] Unsupported file type: ${fileExt}`);
        logger.warn(`[GenerateEdges] Supported extensions: ${registry.getSupportedExtensions().join(', ')}`);
        return {
            filesProcessed: 0,
            filesSkipped: 1,
            errors: [{ filePath, message: `No parser for extension ${fileExt}`, cause: null }],
            newEdges: 0,
            totalEdges: callStore.getStats().edges,
            // Per-file scans don't aggregate allowlist counts — a single
            // unsupported file already shows up as `filesSkipped: 1` with
            // an error message above. Always `{}` on this path.
            unsupportedSourceLikeCounts: {},
            coverage: emptyCoverage(),
        };
    }

    // 'no-artifact' and 'extract-error' both surface as scanFile's throw —
    // matching the legacy `throw new Error('No artifact extracted')` (caught by
    // the inner try) and the outer `Failed to process` wrapper.
    if (!result.ok) {
        const e: any = result.kind === 'extract-error' ? result.error : new Error('No artifact extracted');
        throw new Error(`Failed to process ${filePath}: ${e?.message ?? String(e)}`);
    }

    applyArtifactToStores(result.conversion, callStore, importStore);

    // Save updated edge lists
    await callStore.save();
    await importStore.save();

    const finalCallEdgeCount = callStore.getStats().edges;
    const finalImportEdgeCount = importStore.getStats().edges;
    const actualNewCallEdges = finalCallEdgeCount - existingCallEdgeCount;
    const actualNewImportEdges = finalImportEdgeCount - existingImportEdgeCount;

    logger.info(`[GenerateEdges] Processed file, added ${actualNewCallEdges} call edges, ${actualNewImportEdges} import edges`);

    return {
        filesProcessed: 1,
        filesSkipped: 0,
        errors: [],
        newEdges: actualNewCallEdges + actualNewImportEdges,
        totalEdges: finalCallEdgeCount + finalImportEdgeCount,
        // Per-file scan: nothing to aggregate.
        unsupportedSourceLikeCounts: {},
        coverage: emptyCoverage(),
    };
}
