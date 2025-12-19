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

/**
 * Get edges relevant to a module (folder)
 * 
 * Includes:
 * 1. Edges originating from files in the folder
 * 2. Edges targeting files in the folder (incoming calls/imports)
 * 
 * @param edges All edges
 * @param folderPath Path to the module folder
 * @param recursive Whether to include subdirectories
 */
export function getEdgesForModule(edges: EdgeEntry[], folderPath: string, recursive: boolean = false): EdgeEntry[] {
    // Normalize folder path to ensure trailing slash for prefix matching
    const prefix = folderPath.endsWith('/') || folderPath.endsWith('\\') ? folderPath : folderPath + '/';

    // Helper to check if a file is in the folder
    const isInFolder = (filePath: string) => {
        if (!filePath.startsWith(prefix)) return false;

        if (recursive) return true;

        // If not recursive, check if there are no more separators after the prefix
        // e.g. src/info/file.ts (ok) vs src/info/sub/file.ts (no)
        const relative = filePath.slice(prefix.length);
        return !relative.includes('/') && !relative.includes('\\');
    };

    return edges.filter(edge => {
        // Extract file path from source/target
        // Source for import is fileId
        // Source/Target for call is fileId::entity

        let sourceFile = edge.source;
        if (edge.kind === 'call' && edge.source.includes('::')) {
            sourceFile = edge.source.split('::')[0];
        }

        let targetFile = edge.target;
        if (edge.kind === 'call' && edge.target.includes('::')) {
            targetFile = edge.target.split('::')[0];
        }
        // For imports, target is just the path

        const sourceIn = isInFolder(sourceFile);
        const targetIn = isInFolder(targetFile);

        // Keep edge if it involves the module
        return sourceIn || targetIn;
    });
}
