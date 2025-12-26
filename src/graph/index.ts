/**
 * Graph building from edge list data.
 * 
 * Supports both split stores (ImportEdgeListStore + CallEdgeListStore)
 * and legacy single-file EdgeListStore.
 * 
 * IMPORTANT: Call graph is TypeScript/JavaScript only.
 * Other languages (Python, C++, Rust, R) only produce import graphs.
 */

import { ImportGraph, CallGraph, FileNode, EntityNode, ImportEdge, CallEdge } from './types';
import { EdgeListData } from './edgelist';
import { ALL_SUPPORTED_EXTENSIONS } from '../parser/config';
export { savePlot } from './plot/generator';

/** TypeScript/JavaScript file extensions (only these support call graphs) */
const TS_JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

/**
 * Check if a file is TypeScript/JavaScript (supports call graph).
 * @param filePath - File path or ID to check
 */
export function isTypeScriptFile(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    for (const ext of TS_JS_EXTENSIONS) {
        if (lower.endsWith(ext)) return true;
    }
    return false;
}

/**
 * Build graphs from separate import and call edge list data.
 * This is the primary function for the new split-store architecture.
 *
 * @param importData - Import edge list data
 * @param callData - Call edge list data
 * @param watchedFiles - Optional set of watched file paths. If provided, only include nodes/edges for watched files.
 */
export function buildGraphsFromSplitEdgeLists(
    importData: EdgeListData,
    callData: EdgeListData,
    watchedFiles?: Set<string>
): {
    importGraph: ImportGraph;
    callGraph: CallGraph;
} {
    // Build Import Graph (file-level nodes and import edges)
    const importNodes = new Map<string, FileNode>();
    const importEdges: ImportEdge[] = [];

    // Collect unique file IDs from import nodes
    const fileIds = new Set<string>();
    for (const node of importData.nodes) {
        // Filter: only include files that are watched (if watchedFiles provided)
        if (!watchedFiles || watchedFiles.has(node.fileId)) {
            fileIds.add(node.fileId);
        }
    }

    // Create file nodes
    for (const fileId of fileIds) {
        importNodes.set(fileId, {
            id: fileId,
            kind: 'file',
            label: fileId,
            path: fileId,
            language: 'unknown'
        });
    }

    // Add import edges (include edges to external modules)
    for (const edge of importData.edges) {
        const sourceWatched = !watchedFiles || watchedFiles.has(edge.source);

        // Check if target is an external module (no path separators, no file extension)
        const isTargetExternal = !edge.target.includes('/') &&
            !ALL_SUPPORTED_EXTENSIONS.some(ext => edge.target.endsWith(ext));
        const targetWatched = !watchedFiles || watchedFiles.has(edge.target) || isTargetExternal;

        // Include edge if source is watched AND (target is watched OR target is external)
        if (sourceWatched && targetWatched) {
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
                specifiers: []
            });
        }
    }

    const importGraph: ImportGraph = {
        nodes: importNodes,
        edges: importEdges
    };

    // Build Call Graph (entity-level nodes and call edges)
    // IMPORTANT: Call graph is TypeScript/JavaScript only
    const callNodes = new Map<string, EntityNode>();
    const callEdgesOut: CallEdge[] = [];

    // Create entity nodes from call data (filter by watched files AND TS/JS only)
    for (const node of callData.nodes) {
        if (node.kind !== 'file') {
            // Check if this is an external module node (fileId == id for external modules like 'pathlib')
            const isExternal = node.fileId === node.id ||
                (!node.fileId.includes('/') && !ALL_SUPPORTED_EXTENSIONS.some(ext => node.fileId.endsWith(ext)));

            // Only include nodes from TypeScript/JavaScript files (call graph is TS-only)
            const isTypeScript = isTypeScriptFile(node.fileId);

            // Include node if: (1) it's from a TS/JS file, AND (2) its file is watched or no filter, OR (3) it's external
            if (isTypeScript && (!watchedFiles || watchedFiles.has(node.fileId) || isExternal)) {
                callNodes.set(node.id, {
                    id: node.id,
                    kind: node.kind as 'function' | 'class' | 'method',
                    label: node.name,
                    fileId: node.fileId
                });
            }
        }
    }

    // Add call edges (only between watched nodes)
    for (const edge of callData.edges) {
        if (callNodes.has(edge.source) && callNodes.has(edge.target)) {
            callEdgesOut.push({
                source: edge.source,
                target: edge.target,
                kind: 'call',
                callSiteId: `${edge.source}->${edge.target}`
            });
        }
    }

    const callGraph: CallGraph = {
        nodes: callNodes,
        edges: callEdgesOut,
        unresolved: []
    };

    return { importGraph, callGraph };
}

/**
 * Build graphs directly from edge list data (legacy single-file format).
 * No disk I/O for artifacts - works from in-memory edge list.
 * 
 * @deprecated Use buildGraphsFromSplitEdgeLists() with separate stores
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
    // IMPORTANT: Call graph is TypeScript/JavaScript only
    const callNodes = new Map<string, EntityNode>();
    const callEdges: CallEdge[] = [];

    // Create entity nodes (TS/JS files only for call graph)
    for (const node of data.nodes) {
        if (node.kind !== 'file' && isTypeScriptFile(node.fileId)) {
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
