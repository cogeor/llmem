/**
 * Viewer-data helpers (extracted from `src/application/viewer-data.ts`).
 *
 * These are the deterministic, self-contained building blocks the
 * `collectViewerData` service composes: the TS-scan edge-list populator,
 * the raw-design-doc collector, and the small path/walk utilities. They
 * are lifted verbatim from the parent module (only import depths change,
 * since this file sits one level deeper under `viewer-data/`).
 *
 * Logger discipline: like the parent, this module MUST NOT call console.*.
 */

import * as path from 'path';
import type { WorkspaceRoot, AbsPath } from '../../core/paths';
import { asAbsPath } from '../../core/paths';
import type { Logger } from '../../core/logger';
import { getDesignDocKey } from '../../docs/arch-store';
import { ImportEdgeListStore, CallEdgeListStore } from '../../graph/edgelist';
import { TypeScriptService } from '../../parser/ts-service';
import { TypeScriptExtractor } from '../../parser/ts-extractor';
import { artifactToEdgeList } from '../artifact-converter';
import { LAZY_CODEBASE_LINE_THRESHOLD } from '../../parser/config';
import type { WorkspaceIO } from '../../workspace/workspace-io';

/** Convert an absolute path under the workspace to its workspace-relative POSIX form. */
export function toWorkspaceRel(workspaceRoot: WorkspaceRoot, abs: string): string {
    return path.relative(workspaceRoot, abs).replace(/\\/g, '/');
}

/**
 * Scan codebase and populate split edge lists with TypeScript files.
 * Uses lazy loading: skips call edges for folders exceeding line threshold.
 *
 * Lifted verbatim from `WebviewDataService.scanAndPopulateSplitEdgeLists`,
 * with `console.*` calls replaced by `logger.*`.
 */
export async function scanAndPopulateSplitEdgeLists(
    workspaceRoot: WorkspaceRoot,
    importStore: ImportEdgeListStore,
    callStore: CallEdgeListStore,
    logger: Logger,
): Promise<void> {
    // Initialize TypeScript service
    const tsService = new TypeScriptService(workspaceRoot);
    const tsExtractor = new TypeScriptExtractor(() => tsService.getProgram(), workspaceRoot);

    const program = tsService.getProgram();
    if (!program) {
        logger.warn('[WebviewDataService] No TypeScript program created - this is expected for non-TS/JS projects');
        logger.warn('[WebviewDataService] TypeScript files will not be processed. Other languages use tree-sitter parsers.');
        return;
    }

    // Get all source files (excluding node_modules, declaration files)
    const normalizedRoot = (workspaceRoot as string).replace(/\\/g, '/');
    const sourceFiles = program.getSourceFiles().filter((sf) => {
        const filePath = sf.fileName.replace(/\\/g, '/');
        return !filePath.includes('node_modules') &&
            !filePath.endsWith('.d.ts') &&
            filePath.startsWith(normalizedRoot);
    });

    logger.info(`[WebviewDataService] Scanning ${sourceFiles.length} TypeScript files...`);

    // Count total lines in the codebase to determine eager vs lazy mode.
    // Loop 16: sf.getEnd() was a CHARACTER offset (the absolute byte
    // position of the source-file end), not a line count. With characters
    // counted as lines, even a tiny TS project tripped lazy mode on every
    // load. sf.getLineStarts() returns one entry per line; .length is the
    // exact line count, with no fs I/O (the SourceFile is already parsed).
    let totalCodebaseLines = 0;
    for (const sf of sourceFiles) {
        totalCodebaseLines += sf.getLineStarts().length;
    }

    const isLazyMode = totalCodebaseLines > LAZY_CODEBASE_LINE_THRESHOLD;
    logger.info(`[WebviewDataService] Total codebase lines: ${totalCodebaseLines}, lazy mode: ${isLazyMode} (threshold: ${LAZY_CODEBASE_LINE_THRESHOLD})`);

    let processedCount = 0;

    for (const sf of sourceFiles) {
        const filePath = sf.fileName;
        const relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');

        try {
            // In lazy mode, only create file node (edges loaded on demand)
            if (isLazyMode) {
                const fileNode = {
                    id: relativePath,
                    name: path.basename(filePath),
                    kind: 'file' as const,
                    fileId: relativePath,
                };
                importStore.addNode(fileNode);
                callStore.addNode(fileNode);
                processedCount++;
                continue;
            }

            // Normal processing for small folders
            const artifact = await tsExtractor.extract(filePath);
            if (!artifact) continue;

            const { nodes, importEdges, callEdges } = artifactToEdgeList(artifact, relativePath);

            // Add nodes to both stores
            importStore.addNodes(nodes);
            callStore.addNodes(nodes);

            // Add all edges
            importStore.addEdges(importEdges);
            callStore.addEdges(callEdges);

            processedCount++;
        } catch {
            // Silently skip problematic files (matches legacy behavior)
        }
    }

    logger.info(`[WebviewDataService] Processed ${processedCount} files`);
}

/**
 * Walk `.arch` and return raw markdown keyed by the design-doc key.
 *
 * Replaces `new DesignDocManager(projectRoot).getAllDocsAsync()`. Skips
 * the `marked` render step — callers render on consumption.
 *
 * Returns an empty map if `.arch` does not exist.
 */
export async function collectRawDesignDocs(
    workspaceRoot: WorkspaceRoot,
    archRoot: AbsPath,
    io: WorkspaceIO,
    logger: Logger,
): Promise<Record<string, string>> {
    const docs: Record<string, string> = {};

    const archRel = toWorkspaceRel(workspaceRoot, archRoot);
    if (!(await io.exists(archRel))) {
        return docs;
    }

    // Collect all files under archRoot via the realpath-strong walker.
    const files: string[] = [];
    try {
        await walkDir(io, archRel, (rel) => files.push(rel));
    } catch (e) {
        logger.error(`[WebviewDataService] Error walking .arch: ${e instanceof Error ? e.message : String(e)}`);
    }

    for (const relPath of files) {
        if (!relPath.endsWith('.md')) continue;
        try {
            const markdown = await io.readFile(relPath, 'utf-8');
            const absPath = path.join(workspaceRoot, relPath);
            const key = getDesignDocKey(asAbsPath(archRoot), asAbsPath(absPath));
            docs[key] = markdown;
        } catch (e) {
            logger.error(`Failed to read design doc: ${relPath} — ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    return docs;
}

/**
 * Recursive directory walk via WorkspaceIO. Calls `cb(relPath)` on every file.
 * `relDir` is workspace-relative (POSIX form).
 */
export async function walkDir(
    io: WorkspaceIO,
    relDir: string,
    cb: (relPath: string) => void,
): Promise<void> {
    const entries = await io.readDir(relDir);
    for (const entry of entries) {
        const childRel = relDir === '' || relDir === '.'
            ? entry
            : `${relDir}/${entry}`;
        const stat = await io.stat(childRel);
        if (stat.isDirectory()) {
            await walkDir(io, childRel, cb);
        } else {
            cb(childRel);
        }
    }
}
