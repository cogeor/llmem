/**
 * Graph building from edge list data.
 *
 * Uses split stores (ImportEdgeListStore + CallEdgeListStore).
 *
 * IMPORTANT: Call graph is TypeScript/JavaScript only.
 * Other languages (Python, C++, Rust, R) only produce import graphs.
 */

import { ImportGraph, CallGraph, EntityNode, ImportEdge, CallEdge, ImportGraphNode } from './types';
import { EdgeListData } from './edgelist';
import { parseGraphId, isExternalModuleId } from '../core/ids';
export { savePlot } from './plot/generator';

/**
 * Build a runtime ImportGraphNode from a graph ID.
 *
 * Loop 16: routes through `parseGraphId` instead of the legacy
 * `ALL_SUPPORTED_EXTENSIONS.endsWith` heuristic. The persisted edge-list
 * shape is unchanged — this is a view-time discrimination computed from
 * the ID. See `core/ids.ts` for the contract.
 */
function makeImportNode(id: string): ImportGraphNode {
    const parsed = parseGraphId(id);
    if (parsed.kind === 'external') {
        return { id, kind: 'external', label: id, module: id };
    }
    return { id, kind: 'file', label: id, path: id, language: 'unknown' };
}

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
    const importNodes = new Map<string, ImportGraphNode>();
    const importEdges: ImportEdge[] = [];

    // Collect unique file IDs from import nodes
    const fileIds = new Set<string>();
    for (const node of importData.nodes) {
        // Filter: only include files that are watched (if watchedFiles provided)
        if (!watchedFiles || watchedFiles.has(node.fileId)) {
            fileIds.add(node.fileId);
        }
    }

    // Create file/external nodes via the canonical helper
    for (const fileId of fileIds) {
        importNodes.set(fileId, makeImportNode(fileId));
    }

    // Add import edges (include edges to external modules)
    for (const edge of importData.edges) {
        const sourceWatched = !watchedFiles || watchedFiles.has(edge.source);

        // Loop 16: route through the contract's external-module classifier
        // instead of the local `ALL_SUPPORTED_EXTENSIONS.endsWith` heuristic.
        const isTargetExternal = isExternalModuleId(edge.target);
        const targetWatched = !watchedFiles || watchedFiles.has(edge.target) || isTargetExternal;

        // Include edge if source is watched AND (target is watched OR target is external)
        if (sourceWatched && targetWatched) {
            if (!importNodes.has(edge.source)) {
                importNodes.set(edge.source, makeImportNode(edge.source));
            }
            if (!importNodes.has(edge.target)) {
                importNodes.set(edge.target, makeImportNode(edge.target));
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
            // Loop 16: route through the contract's external classifier
            // instead of duplicating the local heuristic.
            const isExternal = node.fileId === node.id || isExternalModuleId(node.fileId);

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
