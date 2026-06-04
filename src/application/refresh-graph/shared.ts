/**
 * Shared helpers for on-demand graph refresh (LS-06).
 *
 * Used by BOTH the folder path ({@link ../refresh-graph/folder}) and the
 * single-file path ({@link ../refresh-graph/file}). This module imports NEITHER
 * of them — it sits at the leaf of the refresh-graph dependency tree so the two
 * public entrypoints can both depend on it without a cycle.
 */

import * as path from 'path';
import { IGNORED_FOLDERS } from '../../parser/config';
import { type ScanCoverage } from '../scan';
import { type FsStat } from '../scan-manifest';
import type { WorkspaceContext } from '../workspace-context';

/** A fresh, empty coverage struct (mirrors scan.ts `emptyCoverage`). */
export function emptyCoverage(): ScanCoverage {
    return {
        skippedSize: [],
        skippedLines: [],
        skippedDenylist: [],
        parseErrors: [],
    };
}

/**
 * Recursively stat-walk the subtree at `folderPath`, returning a
 * path → {mtimeMs,size} map for every regular FILE found (IGNORED_FOLDERS are
 * pruned, mirroring `scanFolderRecursive`). Stat-only — NO file contents are
 * read, keeping the warm path cheap.
 */
export async function walkFsStats(
    ctx: WorkspaceContext,
    folderPath: string,
): Promise<Record<string, FsStat>> {
    const { io } = ctx;
    const out: Record<string, FsStat> = {};

    async function recur(rel: string): Promise<void> {
        const entries = await io.readDir(rel);
        for (const entry of entries) {
            const childRel = path.join(rel, entry).replace(/\\/g, '/');
            const st = await io.stat(childRel);
            if (st.isDirectory()) {
                if (IGNORED_FOLDERS.has(entry)) continue;
                await recur(childRel);
            } else if (st.isFile()) {
                out[childRel] = { mtimeMs: st.mtimeMs, size: st.size };
            }
        }
    }

    await recur(folderPath);
    return out;
}
