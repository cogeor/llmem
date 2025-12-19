/**
 * Graph filtering functions
 * 
 * Filters for edge list entries to exclude external dependencies
 * and normalize paths for consistent graph representation.
 */

import { EdgeEntry, NodeEntry } from '../graph/edgelist';

/**
 * Check if a path is external (node_modules)
 */
export function isExternalPath(path: string): boolean {
    return path.includes('node_modules');
}

/**
 * Filter import edges to exclude external dependencies
 */
export function filterImportEdges(edges: EdgeEntry[]): EdgeEntry[] {
    return edges.filter(edge => {
        if (edge.kind !== 'import') return true;
        return !isExternalPath(edge.target);
    });
}

/**
 * Filter all edges to only include internal project edges
 */
export function filterInternalEdges(edges: EdgeEntry[]): EdgeEntry[] {
    return edges.filter(edge => {
        return !isExternalPath(edge.source) && !isExternalPath(edge.target);
    });
}

/**
 * Get import edges from a list of edges
 */
export function getImportEdges(edges: EdgeEntry[]): EdgeEntry[] {
    return edges.filter(e => e.kind === 'import');
}

/**
 * Get call edges from a list of edges
 */
export function getCallEdges(edges: EdgeEntry[]): EdgeEntry[] {
    return edges.filter(e => e.kind === 'call');
}

/**
 * Get edges originating from a specific file
 */
export function getEdgesFromFile(edges: EdgeEntry[], fileId: string): EdgeEntry[] {
    return edges.filter(edge => {
        // For import edges, source is the file
        if (edge.kind === 'import') {
            return edge.source === fileId;
        }
        // For call edges, source is entity (fileId::entityName)
        return edge.source.startsWith(fileId + '::');
    });
}

/**
 * Get nodes belonging to a specific file
 */
export function getNodesForFile(nodes: NodeEntry[], fileId: string): NodeEntry[] {
    return nodes.filter(node => node.fileId === fileId);
}
