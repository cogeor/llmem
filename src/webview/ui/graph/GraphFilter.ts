
import { VisNode, VisEdge } from '../types';

interface GraphDataSubset {
    nodes: VisNode[];
    edges: VisEdge[];
}

/**
 * Filter graph to show only the selected node and its immediate neighbors (1-hop).
 */
export function filterOneHopFromNode(graph: GraphDataSubset, selectedId: string): GraphDataSubset {
    const edges = graph.edges || [];
    const nodes = graph.nodes || [];

    const visible = new Set<string>([selectedId]);
    for (const e of edges) {
        if (e.from === selectedId) visible.add(e.to);
        if (e.to === selectedId) visible.add(e.from);
    }

    return {
        nodes: nodes.filter(n => visible.has(n.id)),
        edges: edges.filter(e =>
            (e.from === selectedId && visible.has(e.to)) ||
            (e.to === selectedId && visible.has(e.from))
        ),
    };
}

function normalize(p: string): string {
    return p.replace(/\\/g, '/');
}

/**
 * Filter graph to show all nodes belonging to a file (Call Graph mode)
 * and their external connections.
 */
export function filterFileScope(graph: GraphDataSubset, fileId: string): GraphDataSubset {
    const edges = graph.edges || [];
    const nodes = graph.nodes || [];

    const normFileId = normalize(fileId);

    // 1. Identify internal nodes (belonging to file)
    const internalNodes = new Set<VisNode>();
    const internalNodeIds = new Set<string>();

    for (const n of nodes) {
        if (n.fileId && normalize(n.fileId) === normFileId) {
            internalNodes.add(n);
            internalNodeIds.add(n.id);
        }
        else if (n.id === normFileId) {
            internalNodes.add(n);
            internalNodeIds.add(n.id);
        }
    }

    if (internalNodes.size === 0) {
        return { nodes: [], edges: [] };
    }

    // 2. Find boundary nodes
    const visibleIds = new Set(internalNodeIds);

    for (const e of edges) {
        const fromInternal = internalNodeIds.has(e.from);
        const toInternal = internalNodeIds.has(e.to);

        if (fromInternal && !toInternal) visibleIds.add(e.to);
        if (!fromInternal && toInternal) visibleIds.add(e.from);
    }

    // 3. Filter nodes and edges
    const filteredNodes = nodes.filter(n => visibleIds.has(n.id));
    const filteredEdges = edges.filter(e =>
        (internalNodeIds.has(e.from) && visibleIds.has(e.to)) ||
        (internalNodeIds.has(e.to) && visibleIds.has(e.from))
    );

    return { nodes: filteredNodes, edges: filteredEdges };
}


/**
 * Filter graph for a folder selection.
 */
export function filterFolderScope(graph: GraphDataSubset, subtreeFilesSet: Set<string>): GraphDataSubset {
    const edges = graph.edges || [];
    const nodes = graph.nodes || [];

    // 1) neighbors of any subtree file OR internal nodes
    const visible = new Set<string>();
    const internalNodeIds = new Set<string>();

    // Identify all "internal" nodes
    for (const n of nodes) {
        if (subtreeFilesSet.has(n.id)) {
            internalNodeIds.add(n.id);
            visible.add(n.id);
        }
        else if (n.fileId && subtreeFilesSet.has(n.fileId)) {
            internalNodeIds.add(n.id);
            visible.add(n.id);
        }
    }

    // Identify neighbors
    for (const e of edges) {
        if (internalNodeIds.has(e.from)) visible.add(e.to);
        if (internalNodeIds.has(e.to)) visible.add(e.from);
    }

    // 2) nodes limited to visible
    const filteredNodes = nodes.filter(n => visible.has(n.id));

    // 3) edges limited to "within 1 neighbor" of subtree
    const filteredEdges = edges.filter(e =>
        (internalNodeIds.has(e.from) && visible.has(e.to)) ||
        (internalNodeIds.has(e.to) && visible.has(e.from))
    );

    return { nodes: filteredNodes, edges: filteredEdges };
}
