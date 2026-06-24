// src/graph/call-cycle.ts
//
// Call-graph cycle helpers — the SINGLE SOURCE OF TRUTH for adapting a
// `CallGraph` into the import-graph-typed SCC engine (`./scc`) and for the
// external-entity exclusion that keeps library calls (e.g. `path.join`) from
// manufacturing call cycles.
//
// Why this lives in the GRAPH layer (not application): both the webview payload
// producer (`src/graph/webview-data.ts`, graph layer) AND the health analyzer
// (`src/application/analysis/cycles.ts`, application layer — may import graph)
// must agree on EXACTLY which call edges are in-cycle. Putting the predicate +
// adapter here once means `llmem health` and the webview can never drift. The
// layer matrix forbids webview-data.ts importing application, so the shared code
// must live in graph.

import type { CallGraph, CallEdge, ImportGraph } from './types';
import { computeInCycleEdgeKeys } from './scc';
import { parseGraphId, isExternalModuleId } from '../core/ids';

/**
 * True when `entityId`'s file portion is an external/library module (e.g.
 * `'path::join'`): `parseGraphId` yields `kind:'external'`, or the parsed
 * `fileId` is itself an external module id. Library calls must not manufacture
 * call cycles — this is the call-graph analog of `excludeAggregatorEdges`.
 *
 * Deliberately does NOT use `isAggregatorNode` (the index.ts-basename heuristic
 * is meaningless for `<file>::<name>` entity ids).
 */
export function isExternalEntityId(entityId: string): boolean {
    const parsed = parseGraphId(entityId);
    if (parsed.kind === 'external') {
        return true;
    }
    if (parsed.kind === 'entity') {
        return isExternalModuleId(parsed.fileId);
    }
    return false; // plain file id — keep
}

/**
 * Drop every call edge whose source OR target is an external entity. Run BEFORE
 * the SCC so library calls do not form cycles (mirrors `excludeAggregatorEdges`'
 * spirit for the call graph).
 */
export function excludeExternalCallEdges(callGraph: CallGraph): CallEdge[] {
    return callGraph.edges.filter(
        e => !isExternalEntityId(e.source) && !isExternalEntityId(e.target),
    );
}

/**
 * Adapt a `CallGraph` (external-filtered edges) to the SCC engine's
 * `ImportGraph` shape.
 *
 * SAFE CAST: the engine (`nonTrivialSccs` / `shortestCyclePath` /
 * `computeInCycleEdgeKeys`) reads ONLY `nodes.keys()` and
 * `edge.source`/`edge.target` — never `ImportEdge.specifiers`. `CallEdge`
 * carries `source`/`target`, so the cast through `unknown` is sound and does NOT
 * weaken `scc.ts`'s public types.
 */
export function adaptCallGraphForScc(
    callGraph: CallGraph,
    keptEdges: CallEdge[],
): ImportGraph {
    return {
        nodes: callGraph.nodes,
        edges: keptEdges,
    } as unknown as ImportGraph;
}

/**
 * In-cycle edge keys (`${source}->${target}`) for the call graph: exclude
 * external entities, adapt to the SCC engine, delegate to
 * `computeInCycleEdgeKeys`. The single helper both `webview-data.ts` and
 * `analysis/cycles.ts` use so the webview's red call edges and `llmem health`'s
 * call-cycle findings agree exactly.
 *
 * Note: `computeInCycleEdgeKeys` runs `excludeAggregatorEdges` internally — for
 * entity ids `isAggregatorNode` is false for every entity (no `index.ts`
 * basename after `::`), so that internal pass is a harmless no-op here. The
 * external-entity pre-filter is what does the real exclusion.
 */
export function computeCallInCycleEdgeKeys(callGraph: CallGraph): Set<string> {
    const keptEdges = excludeExternalCallEdges(callGraph);
    return computeInCycleEdgeKeys(adaptCallGraphForScc(callGraph, keptEdges));
}
