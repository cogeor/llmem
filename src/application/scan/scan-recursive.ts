/**
 * Recursive scan use-cases (loop 07): `scanFolderRecursive` and
 * `rescanAfterSchemaMismatch`. Extracted from the former monolithic
 * `application/scan.ts`; depends on `scanFolder` (one-level scan) and the
 * coverage merge helper.
 *
 * Logger discipline: this module MUST NOT call console.*.
 */

import * as path from 'path';
import { CallEdgeListStore, ImportEdgeListStore } from '../../graph/edgelist';
import { isIgnoredDir } from '../../parser/config';
import type { WorkspaceContext } from '../workspace-context';
import type { ScanResult, ScanFolderRequest } from './types';
import { mergeCoverage } from './coverage';
import { scanFolder } from './scan-folder';

/**
 * Clear and repopulate both edge-list stores from scratch. Used by
 * callsites that catch `SchemaMismatchError` from a stale on-disk
 * envelope and need a complete refresh (not just an in-place clear).
 *
 * Does NOT touch folder-tree / folder-edgelist files (those are derived;
 * rerun `buildAndSaveFolderArtifacts` after).
 *
 * The empty `save()` is required because `clear()` only mutates
 * in-memory state on a fresh store; we want the on-disk file replaced
 * even if the recursive scan that follows finds no parser matches
 * (corner case, but the difference between a stale file sitting on disk
 * vs. a clean v_next envelope).
 */
export async function rescanAfterSchemaMismatch(
    ctx: WorkspaceContext,
): Promise<ScanResult> {
    const importStore = new ImportEdgeListStore(ctx.artifactRoot, ctx.artifactIo);
    const callStore = new CallEdgeListStore(ctx.artifactRoot, ctx.artifactIo);
    importStore.clear();
    callStore.clear();
    await importStore.save();
    await callStore.save();
    return scanFolderRecursive(ctx, { folderPath: '.' });
}

/** Scan a folder and all its non-IGNORED subfolders recursively. */
export async function scanFolderRecursive(
    ctx: WorkspaceContext,
    req: ScanFolderRequest,
): Promise<ScanResult> {
    const { folderPath } = req;
    const { io } = ctx;

    if (!(await io.exists(folderPath))) {
        throw new Error(`Folder not found: ${folderPath}`);
    }

    // Process current folder
    const folderResult = await scanFolder(ctx, req);
    let acc: ScanResult = folderResult;

    // Find subfolders. L24: io.readDir + io.stat replace fs.readdirSync +
    // fs.statSync so each child is realpath-validated. isIgnoredDir also
    // marker-checks each entry (pyvenv.cfg / CACHEDIR.TAG) so oddly-named
    // venvs and cache dirs are pruned, not just IGNORED_FOLDERS names.
    const folderAbs = io.resolve(folderPath);
    const entries = await io.readDir(folderPath);
    for (const entry of entries) {
        if (isIgnoredDir(folderAbs, entry)) continue;

        const subRel = path.join(folderPath, entry).replace(/\\/g, '/');
        const st = await io.stat(subRel);
        if (st.isDirectory()) {
            const subResult = await scanFolderRecursive(ctx, {
                folderPath: subRel,
                onFile: req.onFile,
            });
            // Sum allowlist-but-unsupported counts key-by-key. Both sides
            // share the same canonical lowercased-extension keying, so a
            // plain merge suffices.
            const mergedCounts: Record<string, number> = { ...acc.unsupportedSourceLikeCounts };
            for (const [ext, n] of Object.entries(subResult.unsupportedSourceLikeCounts)) {
                mergedCounts[ext] = (mergedCounts[ext] ?? 0) + n;
            }
            // Merge filter coverage across subfolders, mirroring the
            // unsupportedSourceLikeCounts merge: concat the path arrays
            // key-by-key, sum overFileCap, concat parseErrors. Aggregation
            // drops nothing.
            const mergedCoverage = mergeCoverage(acc.coverage, subResult.coverage);
            acc = {
                filesProcessed: acc.filesProcessed + subResult.filesProcessed,
                filesSkipped: acc.filesSkipped + subResult.filesSkipped,
                errors: [...acc.errors, ...subResult.errors],
                newEdges: acc.newEdges + subResult.newEdges,
                // The last sub-recursion's totalEdges is the freshest snapshot
                // (each scanFolder ends in save(); the next load() sees it).
                totalEdges: subResult.totalEdges,
                unsupportedSourceLikeCounts: mergedCounts,
                coverage: mergedCoverage,
            };
        }
    }

    return acc;
}
