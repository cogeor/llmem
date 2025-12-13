
import { buildGraphs } from './index';
import { ColorGenerator } from './utils';

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

export async function prepareWebviewData(artifactDir: string): Promise<WebviewGraphData> {
    // 1. Build Graphs
    const { importGraph, callGraph } = await buildGraphs(artifactDir);
    const colorGen = new ColorGenerator();

    // 2. Prepare Import Graph
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

    // 3. Prepare Call Graph
    const callNodesRaw = Array.from(callGraph.nodes.values());
    // Use the same color generator instance? Or new one? 
    // Ideally consistent colors if nodes are shared. 
    // But call graph nodes might be diff (functions vs files).
    // Let's generate fresh colors for now based on their own hierarchy.
    const callColors = colorGen.generateColors(callNodesRaw);

    const callNodes: VisNode[] = callNodesRaw.map((n: any) => ({
        id: n.id,
        label: n.name || n.label || n.id, // Ensure label exists
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
