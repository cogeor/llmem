/**
 * Filtering logic for the graph view.
 */

/**
 * Filter graph to show only the selected node and its immediate neighbors (1-hop).
 * @param {Object} graph - { nodes: [], edges: [] }
 * @param {string} selectedId 
 */
export function filterOneHopFromNode(graph, selectedId) {
    const edges = graph.edges || [];
    const nodes = graph.nodes || [];

    const visible = new Set([selectedId]);
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

/**
 * Filter graph to show all nodes belonging to a file (Call Graph mode)
 * and their external connections.
 */

/**
 * Normalization helper to match what we do in other places if needed.
 * But ideally IDs in graph data are already normalized.
 * fileId passed in might come from VS Code uri.fsPath which is backslash on Windows.
 */
function normalize(p) {
    return p.replace(/\\/g, '/');
}

/**
 * Filter graph to show all nodes belonging to a file (Call Graph mode)
 * and their external connections.
 */
export function filterFileScope(graph, fileId) {
    const edges = graph.edges || [];
    const nodes = graph.nodes || [];

    const normFileId = normalize(fileId);

    // 1. Identify internal nodes (belonging to file)
    const internalNodes = new Set();
    const internalNodeIds = new Set();

    for (const n of nodes) {
        // fileId might be exact path match
        // For Call Graph, n.fileId is reliable.
        if (n.fileId && normalize(n.fileId) === normFileId) {
            internalNodes.add(n);
            internalNodeIds.add(n.id);
        }
        // For Import Graph, n.id is the file path.
        else if (n.id === normFileId) {
            internalNodes.add(n);
            internalNodeIds.add(n.id);
        }
    }

    if (internalNodes.size === 0) {
        // Fallback or empty
        // If it's a file selection but no nodes found, return empty or try 1-hop if it's an import node
        // (but logic above handles import node via n.id check)
        return { nodes: [], edges: [] };
    }

    // 2. Find boundary nodes (external nodes connected to internal nodes)
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
 * Shows all files in the folder subtree PLUS their immediate neighbors outside the subtree.
 * Edges restricted to those connecting a subtree file to a visible node.
 * 
 * @param {Object} graph 
 * @param {Set<string>} subtreeFilesSet 
 */
export function filterFolderScope(graph, subtreeFilesSet) {
    const edges = graph.edges || [];
    const nodes = graph.nodes || [];

    // For Call Graph, we might have nodes that have fileId in subtreeFilesSet?
    // Let's generalize.

    // 1) neighbors of any subtree file OR internal nodes
    const visible = new Set();
    const internalNodeIds = new Set();

    // Identify all "internal" nodes
    for (const n of nodes) {
        // If node IS a file (Import Graph)
        if (subtreeFilesSet.has(n.id)) {
            internalNodeIds.add(n.id);
            visible.add(n.id);
        }
        // If node BELONGS to a file (Call Graph)
        else if (n.fileId && subtreeFilesSet.has(n.fileId)) {
            internalNodeIds.add(n.id);
            visible.add(n.id);
        }
    }

    // Identify neighbors
    for (const e of edges) {
        if (internalNodeIds.has(e.from)) visible.add(e.to);
        // We generally only care about outgoing edges for "dependencies", but for visual completeness, incoming (references) are also good.
        // User asked for "outgoing edges should also be displayed".
        if (internalNodeIds.has(e.to)) visible.add(e.from);
    }

    // 2) nodes limited to visible
    const filteredNodes = nodes.filter(n => visible.has(n.id));

    // 3) edges limited to "within 1 neighbor" of subtree:
    // keep edges that connect a subtree file to a visible node
    const filteredEdges = edges.filter(e =>
        (internalNodeIds.has(e.from) && visible.has(e.to)) ||
        (internalNodeIds.has(e.to) && visible.has(e.from))
    );

    return { nodes: filteredNodes, edges: filteredEdges };
}
