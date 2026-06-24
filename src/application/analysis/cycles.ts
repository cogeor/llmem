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
import type { ImportGraph, CallGraph } from '../../graph/types';
import {
    excludeAggregatorEdges,
    nonTrivialSccs,
    shortestCyclePath,
} from '../../graph/scc';
import {
    excludeExternalCallEdges,
    adaptCallGraphForScc,
} from '../../graph/call-cycle';
import type { CycleFinding, Finding, CallCycleResult } from './types';

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

/**
 * Pure: derive call-cycle / recursion findings from an already-built CallGraph.
 *
 * External/library entities are dropped BEFORE the SCC (via the shared
 * graph-layer `excludeExternalCallEdges` — the call-graph analog of
 * `excludeAggregatorEdges`) so library calls do not manufacture cycles. The
 * call graph is adapted to the SCC engine (typed against `ImportGraph`) through
 * the documented `adaptCallGraphForScc` cast; the engine reads ONLY
 * `nodes.keys()` + `edge.source`/`edge.target`, never `ImportEdge.specifiers`.
 *
 * Partition of `nonTrivialSccs`: a size-1 non-trivial SCC is necessarily a
 * direct self-loop `f->f` ⇒ the RECURSION bucket (severity 'low', never counted
 * as a cycle); a size>1 SCC is mutual recursion ⇒ a `call-cycle` finding
 * (severity 'medium', lower priority than import cycles).
 *
 * Determinism: `nonTrivialSccs` returns sorted components in stable order and
 * each `scc` array is sorted ascending. Do NOT re-sort. No timestamps.
 */
export function callCyclesFromGraph(callGraph: CallGraph): CallCycleResult {
    const keptEdges = excludeExternalCallEdges(callGraph);
    const adapted = adaptCallGraphForScc(callGraph, keptEdges);

    const sccs = nonTrivialSccs(adapted);

    const cycles: CycleFinding[] = [];
    const recursion: Finding[] = [];

    for (const scc of sccs) {
        if (scc.length === 1) {
            // Size-1 non-trivial SCC == a direct self-loop f->f (the only way
            // size-1 is non-trivial). This is RECURSION, not a cycle.
            const id = scc[0];
            recursion.push({
                id: 'recursion:' + id,
                type: 'recursion',
                severity: 'low',
                title: `direct self-recursion in ${id}`,
                detail: `${id} calls itself directly`,
                relatedFiles: [id],
            });
            continue;
        }
        // Multi-node SCC == mutual recursion == a call cycle.
        const hops = shortestCyclePath(adapted, scc);
        const path =
            hops.length > 0
                ? [hops[0].source, ...hops.map(h => h.target)]
                : [...scc];
        cycles.push({
            id: 'call-cycle:' + scc.join('|'),
            type: 'call-cycle',
            kind: 'call-cycle',
            severity: 'medium',
            title: `${scc.length}-entity call cycle`,
            detail: 'Call cycle through ' + path.join(' -> '),
            relatedFiles: scc,
            members: scc,
            shortestPath: path,
        });
    }

    return { cycles, recursion };
}

/**
 * ctx-in / data-out: load the import + call edge-list stores, build the call
 * graph via `buildGraphsFromSplitEdgeLists`, and delegate to
 * `callCyclesFromGraph`.
 */
export async function findCallCycles(
    ctx: WorkspaceContext,
): Promise<CallCycleResult> {
    const importStore = new ImportEdgeListStore(ctx.artifactRoot, ctx.io);
    const callStore = new CallEdgeListStore(ctx.artifactRoot, ctx.io);
    await importStore.load();
    await callStore.load();
    const { callGraph } = buildGraphsFromSplitEdgeLists(
        importStore.getData(),
        callStore.getData(),
    );
    return callCyclesFromGraph(callGraph);
}
