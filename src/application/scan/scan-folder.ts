/**
 * `scanFolder` use-case (loop 07) — scan one folder's immediate children and
 * append edges. Extracted from the former monolithic `application/scan.ts`
 * and refactored onto the reusable candidate classifier + parser-runner +
 * edge-writer units.
 *
 * Logger discipline: this module MUST NOT call console.*. The `ctx.logger`
 * is used; hosts construct the context with a NoopLogger by default.
 */

import * as path from 'path';
import { CallEdgeListStore, ImportEdgeListStore } from '../../graph/edgelist';
import { countFolderLines } from '../../parser/line-counter';
import { ParserRegistry } from '../../parser/registry';
import type { WorkspaceContext } from '../workspace-context';
import type { ScanError, ScanResult, ScanFolderRequest } from './types';
import { emptyCoverage } from './coverage';
import { classifyScanCandidate } from './candidate';
import { runParser } from './parser-runner';
import { applyArtifactToStores, loadOrClearOnMismatch } from './edge-writer';

/** Scan one folder (immediate children only) and append edges. */
export async function scanFolder(
    ctx: WorkspaceContext,
    req: ScanFolderRequest,
): Promise<ScanResult> {
    const { workspaceRoot, artifactRoot: artifactDir, io, logger, config } = ctx;
    const { folderPath } = req;

    if (!(await io.exists(folderPath))) {
        throw new Error(`Folder not found: ${folderPath}`);
    }

    const absoluteFolder = path.join(io.getRealRoot(), folderPath);

    // Load existing edge lists. Loop 07: see note in scanFile — `io` is
    // the second (mandatory) constructor arg; the boundary logger's
    // shape is incompatible with the edge-list store's, so the stores
    // fall back to their internal `createLogger`.
    const callStore = new CallEdgeListStore(artifactDir, io);
    const importStore = new ImportEdgeListStore(artifactDir, io);
    // Loop 13 (codebase-quality-v2): see scanFile comment — same posture.
    await loadOrClearOnMismatch(callStore, importStore, logger);
    const existingCallEdgeCount = callStore.getStats().edges;
    const existingImportEdgeCount = importStore.getStats().edges;

    logger.info(`[GenerateEdges] Processing folder: ${folderPath}`);
    logger.info(`[GenerateEdges] Existing edges - call: ${existingCallEdgeCount}, import: ${existingImportEdgeCount}`);

    // Count lines in folder
    const lineCount = countFolderLines(workspaceRoot, absoluteFolder);
    logger.info(`[GenerateEdges] Folder stats: ${lineCount.fileCount} files, ${lineCount.totalLines} lines`);

    // Get parser registry (language-agnostic)
    const registry = ParserRegistry.getInstance();

    // Find all supported files in the folder (not recursive, only direct
    // children). L24: io.readDir realpath-validates the directory; io.stat does
    // the same for each entry. The parser API needs an absolute path, so we
    // materialize from getRealRoot() after the realpath check has succeeded.
    //
    // Loop-03 / code-polish: while walking, accumulate per-extension counts
    // of source-like files (the hardcoded `SOURCE_LIKE_INSTALL_HINTS`
    // allowlist) for which `registry.getParser` returns null — these are
    // the files we would otherwise drop without telling the user. C/C++
    // family entries are stored under their real extension (e.g. `.cpp`,
    // `.hpp`) and collapsed at format time. `.R` is pre-lowercased to
    // `.r` so the two share one bucket.
    const entries = await io.readDir(folderPath);
    const sourceFiles: string[] = [];
    const unsupportedCounts = new Map<string, number>();
    const coverage = emptyCoverage();

    // maxFilesPerFolder note (amendments §5): it is a DISPLAY-ONLY context
    // limit, NOT a graph scan cap. It must NEVER drop a file from the graph.
    // It is intentionally not consulted in this walk — no truncation, no
    // overFileCap. A future reader must not re-purpose it as a scan cap here.
    // (`fileCount` counts direct children only since scanFolder is
    // non-recursive per call.)
    void config.maxFilesPerFolder;

    for (const entry of entries) {
        const childRel = path.join(folderPath, entry).replace(/\\/g, '/');
        const stat = await io.stat(childRel);
        if (!stat.isFile()) continue;

        const absoluteChild = path.join(io.getRealRoot(), childRel);

        // --- Filter gates (LS-03). Single classifier, gate order preserved:
        // denylist → size → heuristic flag → source-like accounting → lines.
        // A skipped file is recorded and `continue`d BEFORE any parser is
        // invoked, so no parse work is done on junk. See `classifyScanCandidate`.
        const cls = classifyScanCandidate({
            rel: childRel,
            basename: entry,
            sizeBytes: stat.size,
            absPath: absoluteChild,
            config,
            registry,
            workspaceRoot,
        });

        if (cls.decision === 'skipped-denylist') {
            coverage.skippedDenylist.push(childRel);
            continue;
        }
        if (cls.decision === 'skipped-size') {
            coverage.skippedSize.push(childRel);
            continue;
        }

        // PC-03: flag heuristic-call-graph languages (Python) by EXTENSION,
        // independent of whether the file parses or its grammar is installed.
        // Computed after denylist/size gates, for any in-scope child.
        if (cls.heuristic) {
            coverage.heuristicCallGraph = true;
        }

        // Loop-03: source-like-but-unsupported per-extension accounting.
        if (cls.sourceLikeUnsupported) {
            unsupportedCounts.set(cls.ext, (unsupportedCounts.get(cls.ext) ?? 0) + 1);
        }

        if (cls.decision === 'skipped-lines') {
            coverage.skippedLines.push(childRel);
            continue;
        }

        if (cls.decision === 'parse') {
            sourceFiles.push(absoluteChild);
        }
        // 'unsupported' → not parsed, not a §7 gate; nothing recorded here.
    }

    logger.info(`[GenerateEdges] Found ${sourceFiles.length} supported files in folder`);

    let processedCount = 0;
    let skippedCount = 0;
    const errors: ScanError[] = [];
    let newCallEdgeCount = 0;
    let newImportEdgeCount = 0;

    for (const absoluteFilePath of sourceFiles) {
        const relativePath = path.relative(workspaceRoot, absoluteFilePath).replace(/\\/g, '/');

        // runParser instantiates the language extractor, which lazily
        // require()s the tree-sitter native core inside its constructor. If
        // that native addon failed to build/install, the constructor throws —
        // surface it as a per-file ScanError (not an unhandled crash) with an
        // actionable hint, then skip the file.
        const result = await runParser(registry, logger, {
            rel: relativePath,
            absPath: absoluteFilePath,
            workspaceRoot,
        });

        if (!result.ok && result.kind === 'init-error') {
            const e: any = result.error;
            errors.push({
                filePath: relativePath,
                message:
                    `Failed to initialize parser for ${relativePath}: ${e?.message ?? String(e)}. ` +
                    `The tree-sitter native module may be missing or failed to build — ` +
                    `install build tools or a prebuilt binary for your Node version and reinstall.`,
                cause: e,
            });
            skippedCount++;
            continue;
        }

        if (!result.ok && result.kind === 'no-parser') {
            errors.push({
                filePath: relativePath,
                message: `No parser for ${relativePath}`,
                cause: null,
            });
            skippedCount++;
            continue;
        }

        // Falsy artifact: legacy `if (!artifact) continue;` — silent skip, no
        // error pushed, processedCount NOT incremented.
        if (!result.ok && result.kind === 'no-artifact') {
            continue;
        }

        if (!result.ok && result.kind === 'extract-error') {
            const e: any = result.error;
            errors.push({
                filePath: relativePath,
                message: e?.message ?? String(e),
                cause: e,
            });
            skippedCount++;
            continue;
        }

        if (result.ok) {
            const added = applyArtifactToStores(result.conversion, callStore, importStore);
            newCallEdgeCount += added.callEdges;
            newImportEdgeCount += added.importEdges;
            processedCount++;
        }
    }

    // Save updated edge lists
    await callStore.save();
    await importStore.save();

    const finalCallEdgeCount = callStore.getStats().edges;
    const finalImportEdgeCount = importStore.getStats().edges;
    const actualNewCallEdges = finalCallEdgeCount - existingCallEdgeCount;
    const actualNewImportEdges = finalImportEdgeCount - existingImportEdgeCount;

    logger.info(`[GenerateEdges] Processed ${processedCount} files, added ${actualNewCallEdges} call edges, ${actualNewImportEdges} import edges`);

    // Suppress unused-var lints for raw counters (kept for parity with legacy
    // logging shape where these increment per parser-success).
    void newCallEdgeCount;
    void newImportEdgeCount;

    // Mirror per-file parse failures into the coverage view so callers get
    // gate-skips + parse-errors in one struct.
    coverage.parseErrors = errors;

    return {
        filesProcessed: processedCount,
        filesSkipped: skippedCount,
        errors,
        newEdges: actualNewCallEdges + actualNewImportEdges,
        totalEdges: finalCallEdgeCount + finalImportEdgeCount,
        unsupportedSourceLikeCounts: Object.fromEntries(unsupportedCounts),
        coverage,
    };
}
