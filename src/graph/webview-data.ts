/**
 * Prepares graph data for the visualization webview.
 *
 * Uses split stores (ImportEdgeListStore + CallEdgeListStore).
 */

import { buildGraphsFromSplitEdgeLists } from './index';
import { ColorGenerator } from './utils';
import { EdgeListData } from './edgelist';

export interface VisNode {
    id: string;
    label: string;
    group: string;
    title?: string;
    color?: string;
    fileId?: string;
}

export interface VisEdge {
    from: string;
    to: string;
    arrows?: string;
}

export interface VisData {
    nodes: VisNode[];
    edges: VisEdge[];
}

export interface WebviewGraphData {
    importGraph: VisData;
    callGraph: VisData;
}

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
function transformGraphsToVisData(importGraph: any, callGraph: any): WebviewGraphData {
    const colorGen = new ColorGenerator();

    // Prepare Import Graph
    const importNodesRaw = Array.from(importGraph.nodes.values());
    const importColors = colorGen.generateColors(importNodesRaw);

    const importNodes: VisNode[] = importNodesRaw.map((n: any) => ({
        id: n.id,
        label: n.label,
        group: n.kind || 'default',
        title: n.label,
        color: importColors.get(n.id)
    }));

    const importEdges: VisEdge[] = importGraph.edges.map((e: any) => ({
        from: e.source,
        to: e.target
    }));

    // Prepare Call Graph
    const callNodesRaw = Array.from(callGraph.nodes.values());
    const callColors = colorGen.generateColors(callNodesRaw);

    const callNodes: VisNode[] = callNodesRaw.map((n: any) => ({
        id: n.id,
        label: n.label || n.id,
        group: 'function',
        title: n.id,
        color: callColors.get(n.id),
        fileId: n.fileId
    }));

    const callEdges: VisEdge[] = callGraph.edges.map((e: any) => ({
        from: e.source,
        to: e.target
    }));

    return {
        importGraph: { nodes: importNodes, edges: importEdges },
        callGraph: { nodes: callNodes, edges: callEdges }
    };
}
