/**
 * Scan workflow: walk a file or folder, parse with the registered parser
 * for each extension, append nodes and edges to the persistent edge list
 * stores, and return a structured ScanResult.
 *
 * This is the application-layer service that VS Code, the HTTP server,
 * and the CLI shim (src/scripts/generate-call-edges.ts) consume.
 *
 * Logger discipline: this module MUST NOT call console.*. Pass a
 * Logger; NoopLogger is used when none is provided. (Loop 05 introduced
 * an inline `ScanLogger` interface here; Loop 06 promoted it to
 * `core/logger.ts` so the new `application/viewer-data.ts` module can
 * share the shape.)
 *
 * Error discipline: per-file failures are surfaced through
 * ScanResult.errors. The scan does not throw on individual file errors —
 * it only throws when the input folder/file does not exist.
 *
 * Loop 24: every read-side `fs.*` site is replaced with `WorkspaceIO`
 * calls. The `io: WorkspaceIO` field is REQUIRED on the option types so
 * realpath-strong containment is enforced uniformly (and the cheap
 * textual containment check from `WorkspaceIO.resolve` rejects
 * `../escape` / absolute paths outside the workspace at the boundary).
 */

import * as path from 'path';
import type { WorkspaceRoot } from '../core/paths';
import type { Logger } from '../core/logger';
import { NoopLogger } from '../core/logger';
import { CallEdgeListStore, ImportEdgeListStore } from '../graph/edgelist';
import { artifactToEdgeList } from '../graph/artifact-converter';
import { countFolderLines } from '../parser/line-counter';
import { IGNORED_FOLDERS } from '../parser/config';
import { ParserRegistry } from '../parser/registry';
import { WorkspaceIO } from '../workspace/workspace-io';

/**
 * A per-file failure surfaced to the caller. The scan continues past these
 * (matching the legacy console.warn behavior); callers decide how to render.
 */
export interface ScanError {
    /** Workspace-relative path of the file that failed. */
    filePath: string;
    /** Human-readable error message. */
    message: string;
    /** The original error (Error instance or thrown value). */
    cause: unknown;
}

export interface ScanFolderOptions {
    workspaceRoot: WorkspaceRoot;
    /** Workspace-relative folder path (forward slashes). */
    folderPath: string;
    /** Absolute path to the artifact directory (.artifacts). */
    artifactDir: string;
    /** Required (L24): realpath-strong I/O surface anchored on the workspace root. */
    io: WorkspaceIO;
    /** Optional logger. Defaults to a no-op. */
    logger?: Logger;
}

export interface ScanFileOptions {
    workspaceRoot: WorkspaceRoot;
    /** Workspace-relative file path (forward slashes). */
    filePath: string;
    /** Absolute path to the artifact directory (.artifacts). */
    artifactDir: string;
    /** Required (L24): realpath-strong I/O surface anchored on the workspace root. */
    io: WorkspaceIO;
    /** Optional logger. Defaults to a no-op. */
    logger?: Logger;
}

/**
 * Result of a scan operation. Structured so CLI/HTTP/extension callers can
 * each render output in their own way.
 */
export interface ScanResult {
    /** Number of files processed (parser succeeded). */
    filesProcessed: number;
    /** Number of files skipped (no parser, or per-file failure). */
    filesSkipped: number;
    /** Per-file failures. Empty array when none. */
    errors: ScanError[];
    /** Net new edges added across both stores (call + import). */
    newEdges: number;
    /** Total edges across both stores after the operation. */
    totalEdges: number;
}

/** Scan a single file and append edges. */
export async function scanFile(opts: ScanFileOptions): Promise<ScanResult> {
    const { workspaceRoot, filePath, artifactDir, io } = opts;
    const logger = opts.logger ?? NoopLogger;

    // L24: io.exists performs textual + realpath containment checks.
    // PathEscapeError surfaces to the caller for `../escape`-style inputs.
    if (!(await io.exists(filePath))) {
        throw new Error(`File not found: ${filePath}`);
    }

    // The parser API takes an absolute path; materialize the canonical
    // realpath form via getRealRoot() + filePath now that containment has
    // been validated.
    const absoluteFile = path.join(io.getRealRoot(), filePath);

    // Load existing edge lists. L24: pass `io` for realpath-strong load/save;
    // the edge-list stores' own logger is created internally (their `Logger`
    // shape is `common/logger`'s, not the boundary `core/logger.Logger`
    // accepted by ScanFileOptions / ScanFolderOptions, so we omit it).
    const callStore = new CallEdgeListStore(artifactDir, undefined, io);
    const importStore = new ImportEdgeListStore(artifactDir, undefined, io);
    await callStore.load();
    await importStore.load();
    const existingCallEdgeCount = callStore.getStats().edges;
    const existingImportEdgeCount = importStore.getStats().edges;

    logger.info(`[GenerateEdges] Processing file: ${filePath}`);
    logger.info(`[GenerateEdges] Existing edges - call: ${existingCallEdgeCount}, import: ${existingImportEdgeCount}`);

    // Get parser from registry (language-agnostic)
    const registry = ParserRegistry.getInstance();
    const parser = registry.getParser(filePath, workspaceRoot);

    if (!parser) {
        const fileExt = path.extname(filePath).toLowerCase();
        logger.warn(`[GenerateEdges] Unsupported file type: ${fileExt}`);
        logger.warn(`[GenerateEdges] Supported extensions: ${registry.getSupportedExtensions().join(', ')}`);
        return {
            filesProcessed: 0,
            filesSkipped: 1,
            errors: [{ filePath, message: `No parser for extension ${fileExt}`, cause: null }],
            newEdges: 0,
            totalEdges: callStore.getStats().edges,
        };
    }

    const langId = registry.getLanguageId(filePath);
    logger.info(`[GenerateEdges] Processing ${langId} file: ${filePath}`);

    try {
        const artifact = await parser.extract(absoluteFile);
        if (!artifact) {
            throw new Error('No artifact extracted');
        }

        const { nodes, callEdges, importEdges } = artifactToEdgeList(artifact, filePath);

        // Add nodes to both stores
        callStore.addNodes(nodes);
        importStore.addNodes(nodes);

        // Add call edges
        for (const edge of callEdges) {
            callStore.addEdge(edge);
        }

        // Add import edges
        for (const edge of importEdges) {
            importStore.addEdge(edge);
        }

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
        };
    } catch (e: any) {
        throw new Error(`Failed to process ${filePath}: ${e?.message ?? String(e)}`);
    }
}

/** Scan one folder (immediate children only) and append edges. */
export async function scanFolder(opts: ScanFolderOptions): Promise<ScanResult> {
    const { workspaceRoot, folderPath, artifactDir, io } = opts;
    const logger = opts.logger ?? NoopLogger;

    if (!(await io.exists(folderPath))) {
        throw new Error(`Folder not found: ${folderPath}`);
    }

    const absoluteFolder = path.join(io.getRealRoot(), folderPath);

    // Load existing edge lists. L24: see note in scanFile — `io` is threaded;
    // the boundary logger's shape is incompatible with the edge-list store's,
    // so the stores fall back to their internal `createLogger`.
    const callStore = new CallEdgeListStore(artifactDir, undefined, io);
    const importStore = new ImportEdgeListStore(artifactDir, undefined, io);
    await callStore.load();
    await importStore.load();
    const existingCallEdgeCount = callStore.getStats().edges;
    const existingImportEdgeCount = importStore.getStats().edges;

    logger.info(`[GenerateEdges] Processing folder: ${folderPath}`);
    logger.info(`[GenerateEdges] Existing edges - call: ${existingCallEdgeCount}, import: ${existingImportEdgeCount}`);

    // Count lines in folder
    const lineCount = countFolderLines(workspaceRoot, absoluteFolder);
    logger.info(`[GenerateEdges] Folder stats: ${lineCount.fileCount} files, ${lineCount.totalLines} lines`);

    // Get parser registry (language-agnostic)
    const registry = ParserRegistry.getInstance();

    // Find all supported files in the folder (not recursive, only direct children).
    // L24: io.readDir realpath-validates the directory; io.stat does the same
    // for each entry. The parser API needs an absolute path, so we
    // materialize from getRealRoot() after the realpath check has succeeded.
    const entries = await io.readDir(folderPath);
    const sourceFiles: string[] = [];

    for (const entry of entries) {
        const childRel = path.join(folderPath, entry).replace(/\\/g, '/');
        const stat = await io.stat(childRel);
        if (stat.isFile() && registry.isSupported(entry)) {
            sourceFiles.push(path.join(io.getRealRoot(), childRel));
        }
    }

    logger.info(`[GenerateEdges] Found ${sourceFiles.length} supported files in folder`);

    let processedCount = 0;
    let skippedCount = 0;
    const errors: ScanError[] = [];
    let newCallEdgeCount = 0;
    let newImportEdgeCount = 0;

    for (const absoluteFilePath of sourceFiles) {
        const relativePath = path.relative(workspaceRoot, absoluteFilePath).replace(/\\/g, '/');
        const parser = registry.getParser(absoluteFilePath, workspaceRoot);

        if (!parser) {
            errors.push({
                filePath: relativePath,
                message: `No parser for ${relativePath}`,
                cause: null,
            });
            skippedCount++;
            continue;
        }

        const langId = registry.getLanguageId(absoluteFilePath);
        logger.info(`[GenerateEdges] Processing ${langId} file: ${relativePath}`);

        try {
            const artifact = await parser.extract(absoluteFilePath);
            if (!artifact) continue;

            const { nodes, callEdges, importEdges } = artifactToEdgeList(artifact, relativePath);

            // Add nodes to both stores
            callStore.addNodes(nodes);
            importStore.addNodes(nodes);

            // Add call edges
            for (const edge of callEdges) {
                callStore.addEdge(edge);
            }
            newCallEdgeCount += callEdges.length;

            // Add import edges
            for (const edge of importEdges) {
                importStore.addEdge(edge);
            }
            newImportEdgeCount += importEdges.length;

            processedCount++;
        } catch (e: any) {
            errors.push({
                filePath: relativePath,
                message: e?.message ?? String(e),
                cause: e,
            });
            skippedCount++;
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

    return {
        filesProcessed: processedCount,
        filesSkipped: skippedCount,
        errors,
        newEdges: actualNewCallEdges + actualNewImportEdges,
        totalEdges: finalCallEdgeCount + finalImportEdgeCount,
    };
}

/** Scan a folder and all its non-IGNORED subfolders recursively. */
export async function scanFolderRecursive(opts: ScanFolderOptions): Promise<ScanResult> {
    const { folderPath, io } = opts;

    if (!(await io.exists(folderPath))) {
        throw new Error(`Folder not found: ${folderPath}`);
    }

    // Process current folder
    const folderResult = await scanFolder(opts);
    let acc: ScanResult = folderResult;

    // Find subfolders. L24: io.readDir + io.stat replace fs.readdirSync +
    // fs.statSync so each child is realpath-validated.
    const entries = await io.readDir(folderPath);
    for (const entry of entries) {
        if (IGNORED_FOLDERS.has(entry)) continue;

        const subRel = path.join(folderPath, entry).replace(/\\/g, '/');
        const st = await io.stat(subRel);
        if (st.isDirectory()) {
            const subResult = await scanFolderRecursive({
                ...opts,
                folderPath: subRel,
            });
            acc = {
                filesProcessed: acc.filesProcessed + subResult.filesProcessed,
                filesSkipped: acc.filesSkipped + subResult.filesSkipped,
                errors: [...acc.errors, ...subResult.errors],
                newEdges: acc.newEdges + subResult.newEdges,
                // The last sub-recursion's totalEdges is the freshest snapshot
                // (each scanFolder ends in save(); the next load() sees it).
                totalEdges: subResult.totalEdges,
            };
        }
    }

    return acc;
}
