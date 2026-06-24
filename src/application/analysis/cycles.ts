/**
 * Import-cycle analyzer.
 *
 * Lifts the SCC pipeline that `src/cli/commands/find-cycles.ts` currently
 * inlines into a reusable, ctx-in / data-out analyzer that emits `CycleFinding`
 * DTOs instead of a printable string. Provides BOTH a pure inner function over
 * an already-built `ImportGraph` (no IO — directly unit-testable) and the
 * ctx-loading wrapper that builds the graph from the edge-list stores.
 *
 * Determinism: `excludeAggregatorEdges -> nonTrivialSccs -> shortestCyclePath`
 * is deterministic and the engine already returns sorted components; this module
 * does NOT re-sort and emits no timestamps.
 *
 * Note: `find-cycles.ts` keeps its own inlined copy this loop — Loop 02
 * re-points it at this analyzer.
 */

import type { WorkspaceContext } from '../workspace-context';
import { ImportEdgeListStore, CallEdgeListStore } from '../../graph/edgelist';
import { buildGraphsFromSplitEdgeLists } from '../../graph';
import type { ImportGraph } from '../../graph/types';
import {
    excludeAggregatorEdges,
    nonTrivialSccs,
    shortestCyclePath,
} from '../../graph/scc';
import type { CycleFinding } from './types';

/**
 * Pure: derive import `CycleFinding`s from an already-built `ImportGraph`.
 *
 * Mirrors `find-cycles.ts`'s `buildCycleReport` pipeline but emits DTOs. Engine
 * order is already deterministic (sorted SCCs, each sorted internally) — do NOT
 * re-sort.
 */
export function importCyclesFromGraph(importGraph: ImportGraph): CycleFinding[] {
    const g = excludeAggregatorEdges(importGraph);
    const sccs = nonTrivialSccs(g);

    // Recall-first: the SCCs above span ALL edges (type-only included). The
    // runtime-vs-type-only split is a report-time derivation — re-run the SAME
    // SCC engine over a node-preserving COPY with type-only edges filtered out
    // (`tarjanSccs` reads only e.source/e.target, so the filter is safe). A node
    // that still sits in some runtime SCC is a `runtimeCyclicNode`; intersecting
    // those with each reported SCC yields its surviving runtime core.
    const gRuntime: ImportGraph = {
        nodes: new Map(g.nodes),
        edges: g.edges.filter(e => !e.typeOnly),
    };
    const runtimeSccs = nonTrivialSccs(gRuntime);
    const runtimeCyclicNodes = new Set<string>();
    for (const component of runtimeSccs) {
        for (const id of component) {
            runtimeCyclicNodes.add(id);
        }
    }

    return sccs.map((scc): CycleFinding => {
        const hops = shortestCyclePath(g, scc);
        const path =
            hops.length > 0
                ? [hops[0].source, ...hops.map(h => h.target)]
                : [...scc];

        // In-cycle edges of THIS scc: both endpoints in the scc member set.
        const memberSet = new Set(scc);
        const inCycleEdges = g.edges.filter(
            e => memberSet.has(e.source) && memberSet.has(e.target),
        );
        const totalEdgeCount = inCycleEdges.length;
        const typeOnlyEdgeCount = inCycleEdges.filter(e => e.typeOnly === true).length;

        // Members surviving type-only edge removal, intersected with this scc.
        // Sorted for determinism (the scc array is already sorted, but be explicit).
        const runtimeMembers = scc
            .filter(id => runtimeCyclicNodes.has(id))
            .sort();

        return {
            id: 'import-cycle:' + scc.join('|'),
            type: 'import-cycle',
            kind: 'import-cycle',
            severity: 'high',
            title: `${scc.length}-file import cycle`,
            detail: 'Import cycle through ' + path.join(' -> '),
            relatedFiles: scc,
            members: scc,
            shortestPath: path,
            typeOnlyEdgeCount,
            totalEdgeCount,
            runtimeMembers,
        };
    });
}

/**
 * ctx-in / data-out: load the import + call edge-list stores, build the import
 * graph via `buildGraphsFromSplitEdgeLists`, and delegate to
 * `importCyclesFromGraph`.
 */
export async function findImportCycles(
    ctx: WorkspaceContext,
): Promise<CycleFinding[]> {
    const importStore = new ImportEdgeListStore(ctx.artifactRoot, ctx.io);
    const callStore = new CallEdgeListStore(ctx.artifactRoot, ctx.io);
    await importStore.load();
    await callStore.load();
    const { importGraph } = buildGraphsFromSplitEdgeLists(
        importStore.getData(),
        callStore.getData(),
    );
    return importCyclesFromGraph(importGraph);
}
