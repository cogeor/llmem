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

    return sccs.map((scc): CycleFinding => {
        const hops = shortestCyclePath(g, scc);
        const path =
            hops.length > 0
                ? [hops[0].source, ...hops.map(h => h.target)]
                : [...scc];

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
