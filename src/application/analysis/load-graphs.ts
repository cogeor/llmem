/**
 * Shared graph loader for the analysis layer (D1, 2026-07-13).
 *
 * Before this module, `runHealthScan` called five ctx-wrappers that EACH
 * constructed the edge-list stores, parsed both JSON files, and rebuilt the
 * graphs (4 graph builds + 5 store parses per health run; `review` added
 * its own build and then triggered four more). `loadGraphs` does the
 * construct + load + build exactly ONCE and hands out the graphs plus the
 * cheap by-products every consumer re-derived: the snapshot timestamp and
 * the size stats for the report header.
 *
 * The per-analyzer ctx-wrappers (`findImportCycles`, `computeInterfaceWidth`,
 * …) remain for external callers but are one-liners over this loader; the
 * composer feeds the pure `*FromGraph` cores directly.
 */

import { ImportEdgeListStore, CallEdgeListStore } from '../../graph/edgelist';
import { buildGraphsFromSplitEdgeLists } from '../../graph';
import type { ImportGraph, CallGraph } from '../../graph/types';
import type { WorkspaceContext } from '../workspace-context';

export interface LoadedGraphs {
    importGraph: ImportGraph;
    callGraph: CallGraph;
    /** ISO timestamp persisted in the import edge list (graph-snapshot note). */
    timestamp: string;
    /** Raw node count of the import edge list (0 ⇒ nothing scanned yet). */
    importNodeCount: number;
    /** Size stats for the health-report header (C1). */
    stats: { files: number; importEdges: number; callEdges: number };
}

/** Construct + load both edge-list stores once and build both graphs. */
export async function loadGraphs(ctx: WorkspaceContext): Promise<LoadedGraphs> {
    const importStore = new ImportEdgeListStore(ctx.artifactRoot, ctx.artifactIo);
    const callStore = new CallEdgeListStore(ctx.artifactRoot, ctx.artifactIo);
    await importStore.load();
    await callStore.load();

    const importData = importStore.getData();
    const callData = callStore.getData();
    const { importGraph, callGraph } = buildGraphsFromSplitEdgeLists(
        importData,
        callData,
    );

    // Distinct fileIds over import nodes — matches the old `stats` command.
    const fileIds = new Set<string>();
    for (const n of importData.nodes) fileIds.add(n.fileId);

    return {
        importGraph,
        callGraph,
        timestamp: importData.timestamp,
        importNodeCount: importData.nodes.length,
        stats: {
            files: fileIds.size,
            importEdges: importData.edges.length,
            callEdges: callData.edges.length,
        },
    };
}
