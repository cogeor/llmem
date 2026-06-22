/**
 * Prepares graph data for the visualization webview.
 *
 * Uses split stores (ImportEdgeListStore + CallEdgeListStore).
 */

import { buildGraphsFromSplitEdgeLists } from './index';
import { computeInCycleEdgeKeys } from './scc';
import { ColorGenerator } from './utils';
import { EdgeListData } from './edgelist';
import type { ImportGraph, CallGraph } from './types';
import type { VisNode, VisEdge, GraphData } from '../contracts/webview-payloads';

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
 */
export function prepareWebviewDataFromSplitEdgeLists(
    importData: EdgeListData,
    callData: EdgeListData,
    watchedFiles?: Set<string>
): WebviewGraphData {
    const { importGraph, callGraph } = buildGraphsFromSplitEdgeLists(importData, callData, watchedFiles);
    return transformGraphsToVisData(importGraph, callGraph);
}

/**
 * Transform internal graph structures to visualization format.
 */
function transformGraphsToVisData(importGraph: ImportGraph, callGraph: CallGraph): WebviewGraphData {
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
        color: importColors.get(n.id)
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
        callGraph: n.callGraph
    }));

    const callEdges: VisEdge[] = callGraph.edges.map((e) => ({
        from: e.source,
        to: e.target
    }));

    return {
        importGraph: { nodes: importNodes, edges: importEdges },
        callGraph: { nodes: callNodes, edges: callEdges }
    };
}
