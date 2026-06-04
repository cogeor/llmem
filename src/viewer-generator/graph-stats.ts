/**
 * Edge-list presence + statistics queries for the Claude web launcher
 * (Loop 15 split).
 *
 * Carved verbatim from the former `web-launcher.ts` monolith:
 *   - `hasEdgeLists`  — fast presence probe for the split edge lists.
 *   - `getGraphStats` — node/edge/file counts without generating a graph.
 *
 * Re-exported through the `web-launcher.ts` barrel so existing import sites
 * keep working unchanged.
 */

import * as path from 'path';
import * as fs from 'fs';
import { ImportEdgeListStore, CallEdgeListStore, SchemaMismatchError } from '../graph/edgelist';
import { createLogger } from '../common/logger';
import { rescanAfterSchemaMismatch } from '../application/scan';
import { type WorkspaceContext } from '../application/workspace-context';
import { DEFAULT_CONFIG } from '../config-defaults';

const log = createLogger('web-launcher');

/**
 * Check if edge lists exist for a workspace
 *
 * @param workspaceRoot - Workspace root directory
 * @param artifactRoot - Artifact root (default: DEFAULT_CONFIG.artifactRoot)
 * @returns True if edge lists exist
 */
export function hasEdgeLists(
    workspaceRoot: string,
    artifactRoot: string = DEFAULT_CONFIG.artifactRoot
): boolean {
    const artifactDir = path.join(workspaceRoot, artifactRoot);
    const importEdgeListPath = path.join(artifactDir, 'import-edgelist.json');
    const callEdgeListPath = path.join(artifactDir, 'call-edgelist.json');
    return fs.existsSync(importEdgeListPath) && fs.existsSync(callEdgeListPath);
}

/**
 * Get edge list statistics without generating graph
 *
 * Loop 04: takes a `WorkspaceContext` instead of
 * `(workspaceRoot, artifactRoot?)`.
 *
 * @param ctx - WorkspaceContext for the target workspace
 * @returns Statistics about the edge lists
 */
export async function getGraphStats(
    ctx: WorkspaceContext,
): Promise<{
    importNodes: number;
    importEdges: number;
    callNodes: number;
    callEdges: number;
    fileCount: number;
    lastUpdated: string;
}> {
    const artifactDir = ctx.artifactRoot;

    const importStore = new ImportEdgeListStore(artifactDir, ctx.io);
    const callStore = new CallEdgeListStore(artifactDir, ctx.io);

    // Loop 13 (codebase-quality-v2): a stats query over a stale envelope
    // is a worse failure than a slow first call — surface the same
    // rescan helper here so the returned numbers always reflect the
    // current resolver semantics.
    try {
        await importStore.load();
        await callStore.load();
    } catch (e) {
        if (!(e instanceof SchemaMismatchError)) throw e;
        log.warn('Edge-list schema mismatch in getGraphStats — rescanning', { artifactDir });
        await rescanAfterSchemaMismatch(ctx);
        await importStore.load();
        await callStore.load();
    }

    const importData = importStore.getData();
    const callData = callStore.getData();

    // Count unique files from import data
    const fileIds = new Set<string>();
    for (const node of importData.nodes) {
        fileIds.add(node.fileId);
    }

    return {
        importNodes: importData.nodes.length,
        importEdges: importData.edges.length,
        callNodes: callData.nodes.length,
        callEdges: callData.edges.length,
        fileCount: fileIds.size,
        lastUpdated: importData.timestamp,
    };
}
