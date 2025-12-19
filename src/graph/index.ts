/**
 * Graph building from edge list data.
 * 
 * Legacy artifact-based building has been removed.
 * Use EdgeListStore + buildGraphsFromEdgeList() instead.
 */

import { ImportGraph, CallGraph, FileNode, EntityNode, ImportEdge, CallEdge } from './types';
import { EdgeListData } from './edgelist';
export { savePlot } from './plot/generator';

/**
 * Build graphs directly from edge list data.
 * No disk I/O for artifacts - works from in-memory edge list.
 */
export function buildGraphsFromEdgeList(data: EdgeListData): {
    importGraph: ImportGraph;
    callGraph: CallGraph;
} {
    // Build Import Graph (file-level nodes and import edges)
    const importNodes = new Map<string, FileNode>();
    const importEdges: ImportEdge[] = [];

    // Collect unique file IDs from nodes
    const fileIds = new Set<string>();
    for (const node of data.nodes) {
        fileIds.add(node.fileId);
    }

    // Create file nodes
    for (const fileId of fileIds) {
        importNodes.set(fileId, {
            id: fileId,
            kind: 'file',
            label: fileId,
            path: fileId,
            language: 'unknown' // Could be enhanced later
        });
    }

    // Add import edges (only where both source and target are known files)
    for (const edge of data.edges) {
        if (edge.kind === 'import') {
            // Only include edges where target is a known file in our project
            if (fileIds.has(edge.source) && fileIds.has(edge.target)) {
                // Add nodes if not already present
                if (!importNodes.has(edge.source)) {
                    importNodes.set(edge.source, {
                        id: edge.source,
                        kind: 'file',
                        label: edge.source,
                        path: edge.source,
                        language: 'unknown'
                    });
                }
                if (!importNodes.has(edge.target)) {
                    importNodes.set(edge.target, {
                        id: edge.target,
                        kind: 'file',
                        label: edge.target,
                        path: edge.target,
                        language: 'unknown'
                    });
                }

                importEdges.push({
                    source: edge.source,
                    target: edge.target,
                    kind: 'import',
                    specifiers: [] // Edge list doesn't track specifiers
                });
            }
        }
    }

    const importGraph: ImportGraph = {
        nodes: importNodes,
        edges: importEdges
    };

    // Build Call Graph (entity-level nodes and call edges)
    const callNodes = new Map<string, EntityNode>();
    const callEdges: CallEdge[] = [];

    // Create entity nodes
    for (const node of data.nodes) {
        if (node.kind !== 'file') {
            callNodes.set(node.id, {
                id: node.id,
                kind: node.kind as 'function' | 'class' | 'method',
                label: node.name,
                fileId: node.fileId
            });
        }
    }

    // Add call edges
    for (const edge of data.edges) {
        if (edge.kind === 'call') {
            // Ensure both source and target nodes exist
            if (callNodes.has(edge.source) && callNodes.has(edge.target)) {
                callEdges.push({
                    source: edge.source,
                    target: edge.target,
                    kind: 'call',
                    callSiteId: `${edge.source}->${edge.target}`
                });
            }
        }
    }

    const callGraph: CallGraph = {
        nodes: callNodes,
        edges: callEdges,
        unresolved: [] // Edge list approach resolves during extraction
    };

    return { importGraph, callGraph };
}
