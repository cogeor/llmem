/**
 * Prepares graph data for the visualization webview.
 * 
 * Legacy artifact-based preparation has been removed.
 * Use prepareWebviewDataFromEdgeList() instead.
 */

import { buildGraphsFromEdgeList } from './index';
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
 * Prepare webview data from edge list.
 * No disk I/O for artifacts.
 */
export function prepareWebviewDataFromEdgeList(data: EdgeListData): WebviewGraphData {
    const { importGraph, callGraph } = buildGraphsFromEdgeList(data);
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
