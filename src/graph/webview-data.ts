/**
 * Prepares graph data for the visualization webview.
 *
 * Uses split stores (ImportEdgeListStore + CallEdgeListStore).
 */

import { buildGraphsFromSplitEdgeLists } from './index';
import { computeInCycleEdgeKeys } from './scc';
import { computeCallInCycleEdgeKeys } from './call-cycle';
import { ColorGenerator } from './utils';
import { EdgeListData } from './edgelist';
import type { ImportGraph, CallGraph } from './types';
import type { VisNode, VisEdge, GraphData, HealthOverlay } from '../contracts/webview-payloads';

// A-grade #4: the injected viewer payload DTOs (`VisNode` / `VisEdge` /
// `GraphData`) have a single home in `src/contracts/webview-payloads.ts`.
// This module no longer declares its own copies; it re-exports the contract
// types so existing `WebviewGraphData` importers keep compiling.
export type { VisNode, VisEdge } from '../contracts/webview-payloads';

/**
 * The server-prepared graph payload injected as `window.GRAPH_DATA`. Alias of
 * the contract `GraphData` so the producer and the browser consumer share one
 * shape.
 */
export type WebviewGraphData = GraphData;

/**
 * Prepare webview data from split edge lists (new architecture).
 *
 * @param importData - Import edge list data
 * @param callData - Call edge list data
 * @param watchedFiles - Optional set of watched file paths. If provided, only include nodes/edges for watched files.
 * @param health - Loop 08: OPTIONAL plain-data health overlay (clone edges +
 *   node smells) assembled by a host. When omitted (current callers), the
 *   prepared payload is byte-identical to today.
 */
export function prepareWebviewDataFromSplitEdgeLists(
    importData: EdgeListData,
    callData: EdgeListData,
    watchedFiles?: Set<string>,
    health?: HealthOverlay
): WebviewGraphData {
    const { importGraph, callGraph } = buildGraphsFromSplitEdgeLists(importData, callData, watchedFiles);
    return transformGraphsToVisData(importGraph, callGraph, health);
}

/**
 * Transform internal graph structures to visualization format.
 */
function transformGraphsToVisData(
    importGraph: ImportGraph,
    callGraph: CallGraph,
    health?: HealthOverlay
): WebviewGraphData {
    const colorGen = new ColorGenerator();

    // Prepare Import Graph
    const importNodesRaw = Array.from(importGraph.nodes.values());
    const importColors = colorGen.generateColors(importNodesRaw);

    // Loop 16: external module nodes carry kind: 'external' at runtime.
    // Pre-Loop-16 the persisted shape used kind: 'file' and the vis group
    // coincidentally rendered them as 'file'. After Loop 16 they get
    // group: 'external' here. Visual styling is intentionally left to a
    // follow-up loop; the webview already styles 'file' but not 'external'.
    const importNodes: VisNode[] = importNodesRaw.map((n) => ({
        id: n.id,
        label: n.label,
        group: n.kind || 'default',
        title: n.label,
        color: importColors.get(n.id),
        // Loop 08: fold node smells (hub smells attach to import file nodes).
        ...(health?.nodeSmells[n.id]?.length ? { smells: health.nodeSmells[n.id] } : {})
    }));

    const cycleKeys = computeInCycleEdgeKeys(importGraph);

    const importEdges: VisEdge[] = importGraph.edges.map((e) => ({
        from: e.source,
        to: e.target,
        ...(cycleKeys.has(`${e.source}->${e.target}`) ? { inCycle: true } : {})
    }));

    // Prepare Call Graph
    const callNodesRaw = Array.from(callGraph.nodes.values());
    const callColors = colorGen.generateColors(callNodesRaw);

    const callNodes: VisNode[] = callNodesRaw.map((n) => ({
        id: n.id,
        label: n.label || n.id,
        group: 'function',
        title: n.id,
        color: callColors.get(n.id),
        fileId: n.fileId,
        // PC-04: forward the baked per-node call-graph capability so the
        // browser can badge heuristic-language nodes.
        callGraph: n.callGraph,
        // Loop 08: fold node smells (clone-membership smells attach to call
        // entity nodes; either graph can badge).
        ...(health?.nodeSmells[n.id]?.length ? { smells: health.nodeSmells[n.id] } : {})
    }));

    // Loop 08: set of call-graph node ids — used to guard ADDED clone edges so
    // we never reference a node the renderer can't place (CORRECTION 1).
    const callNodeIds = new Set(callNodes.map((n) => n.id));

    // Loop 04: tag call edges that sit in a non-trivial call SCC. Uses the
    // SAME shared graph-layer helper (`computeCallInCycleEdgeKeys`) the health
    // analyzer (`analysis/cycles.ts`) uses, so `llmem health` and the webview
    // agree exactly on which call edges are in-cycle. Acyclic call edges omit
    // the flag (undefined), matching import-edge behavior.
    const callCycleKeys = computeCallInCycleEdgeKeys(callGraph);

    const callEdges: VisEdge[] = callGraph.edges.map((e) => ({
        from: e.source,
        to: e.target,
        ...(callCycleKeys.has(`${e.source}->${e.target}`) ? { inCycle: true } : {})
    }));

    // Loop 08 (CORRECTION 1): clone edges are NEW edges, not annotations. Two
    // cloned entities almost never have an existing call edge between them, so
    // each `health.cloneEdges` pair is ADDED to the call-edge list as a fresh
    // `isClone` `VisEdge`. Endpoint-presence GUARD: only add a clone edge when
    // BOTH endpoints are rendered call nodes — otherwise the edge would point
    // at a non-existent node and the renderer can't place it.
    if (health?.cloneEdges?.length) {
        for (const c of health.cloneEdges) {
            if (!callNodeIds.has(c.source) || !callNodeIds.has(c.target)) {
                continue; // drop: an endpoint isn't a rendered call node.
            }
            callEdges.push({
                from: c.source,
                to: c.target,
                isClone: true,
                cloneSeverity: c.severity,
            });
        }
    }

    return {
        importGraph: { nodes: importNodes, edges: importEdges },
        callGraph: { nodes: callNodes, edges: callEdges }
    };
}
