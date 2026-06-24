/**
 * Graph building from edge list data.
 *
 * Uses split stores (ImportEdgeListStore + CallEdgeListStore).
 *
 * Call graph spans languages whose LANGUAGES descriptor declares a capability:
 * 'semantic' (TS/JS) and 'heuristic' (Python). C/C++/Rust/R (callGraph 'none')
 * produce import graphs only.
 */

import { ImportGraph, CallGraph, EntityNode, ImportEdge, CallEdge, ImportGraphNode } from './types';
import { EdgeListData } from './edgelist';
import { parseGraphId, isExternalModuleId } from '../core/ids';
import { ALL_SUPPORTED_EXTENSIONS } from '../core/language-descriptors';
export { savePlot } from './plot/generator';

/**
 * Python package-import repair.
 *
 * A `from aipr.domain import models` where `aipr/domain/models/` is a PACKAGE
 * dir (has `__init__.py`) is converted to the MODULE-form target
 * `src/aipr/domain/models.py`. But the real file-node is the package init
 * `src/aipr/domain/models/__init__.py`. The converter is a pure function with
 * no node-set access, so it can't distinguish a module from a package — that
 * disambiguation must happen here, where the full file-node set is known.
 *
 * Given a module-form target, returns the package-init candidate by stripping
 * the source extension and re-appending `/__init__<ext>`
 * (e.g. `.../models.py` → `.../models/__init__.py`). Returns null if the target
 * has no recognized source extension.
 */
function packageInitCandidate(target: string): string | null {
    for (const ext of ALL_SUPPORTED_EXTENSIONS) {
        if (target.endsWith(ext)) {
            const stem = target.slice(0, target.length - ext.length);
            return `${stem}/__init__${ext}`;
        }
    }
    return null;
}

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

    // Create file/external nodes via the canonical helper. `fileIds` is the
    // set of REAL file-nodes (the persisted file nodes, after the watched
    // filter) — the dangling-node filter below uses it to decide which edge
    // endpoints are legitimate.
    for (const fileId of fileIds) {
        importNodes.set(fileId, makeImportNode(fileId));
    }

    // Add import edges with a DANGLING-NODE FILTER (LS-07).
    //
    // The old loop SYNTHESIZED a phantom makeImportNode for ANY edge endpoint,
    // so a deleted file with incoming imports still rendered as a node + edge.
    // We now mirror the call graph's both-endpoints filter (below): an import
    // edge is kept ONLY when each endpoint either (a) is a real file-node in
    // `fileIds`, or (b) is an external module (npm package etc.). We never
    // fabricate a file-node for a non-existent target — that is the self-healing
    // behavior on every build, so a stale edge to a deleted file simply drops.
    //
    // External-module nodes still need to be CREATED on demand (they have no
    // entry in importData.nodes), so we synthesize them here — but only for
    // genuinely external endpoints, never for missing files.
    const isRealEndpoint = (id: string): boolean =>
        importNodes.has(id) || isExternalModuleId(id);

    for (const edge of importData.edges) {
        const sourceWatched = !watchedFiles || watchedFiles.has(edge.source);

        // Loop 16: route through the contract's external-module classifier
        // instead of the local `ALL_SUPPORTED_EXTENSIONS.endsWith` heuristic.
        const isTargetExternal = isExternalModuleId(edge.target);

        // PYTHON PACKAGE-IMPORT REPAIR: when the module-form target has no
        // real file-node and is not external, try the package `__init__` form
        // (e.g. `src/aipr/domain/models.py` → `.../models/__init__.py`). If
        // that candidate IS a real file-node, redirect the edge to it so the
        // package import draws to the real node instead of being dropped as
        // dangling. The converter can't make this call — it has no node set.
        let effectiveTarget = edge.target;
        if (!isTargetExternal && !isRealEndpoint(edge.target)) {
            const candidate = packageInitCandidate(edge.target);
            if (candidate && importNodes.has(candidate)) {
                effectiveTarget = candidate;
            }
        }

        const targetWatched =
            !watchedFiles || watchedFiles.has(effectiveTarget) || isTargetExternal;

        // Both endpoints must be watched-eligible AND resolve to a real node
        // (existing file-node or external module). A non-external endpoint with
        // no file-node is a deleted/phantom file — drop the edge, don't render.
        if (sourceWatched && targetWatched && isRealEndpoint(edge.source) && isRealEndpoint(effectiveTarget)) {
            // Only external endpoints need on-demand node creation here; real
            // file-nodes were already added from `fileIds` above.
            if (!importNodes.has(edge.source)) {
                importNodes.set(edge.source, makeImportNode(edge.source));
            }
            if (!importNodes.has(effectiveTarget)) {
                importNodes.set(effectiveTarget, makeImportNode(effectiveTarget));
            }

            importEdges.push({
                source: edge.source,
                target: effectiveTarget,
                kind: 'import',
                specifiers: [],
                // LOAD-BEARING: the ImportEdge is RECONSTRUCTED here (not passed
                // through), so the persisted `typeOnly` flag must be forwarded
                // explicitly or it is silently dropped for every downstream
                // consumer (notably the import-cycle analyzer's runtime split).
                typeOnly: edge.typeOnly
            });
        }
    }

    const importGraph: ImportGraph = {
        nodes: importNodes,
        edges: importEdges
    };

    // Build Call Graph (entity-level nodes and call edges)
    // Call graph spans every language whose descriptor declares a call-graph
    // capability: 'semantic' (TS/JS) or 'heuristic' (Python). Languages with
    // callGraph 'none' (C/C++/Rust/R) and unknown extensions are excluded.
    const callNodes = new Map<string, EntityNode>();
    const callEdgesOut: CallEdge[] = [];

    // Create entity nodes from call data (filter by watched files AND call-graph capability)
    for (const node of callData.nodes) {
        if (node.kind !== 'file') {
            // Loop 16: route through the contract's external classifier
            // instead of duplicating the local heuristic.
            const isExternal = node.fileId === node.id || isExternalModuleId(node.fileId);

            // Include nodes whose file has a call-graph capability (semantic or
            // heuristic) — PC: the call graph is no longer TS-only.
            // PC-04 / Loop 12: read the capability that the converter PERSISTED
            // onto the node (node.callGraph) instead of re-importing
            // parser/config here. A node without the field (legacy in-memory
            // construction in a test, external/synthesized module node) defaults
            // to 'none' and is excluded — same outcome the parser lookup gave
            // for non-source ids.
            const callGraphCapability = node.callGraph ?? 'none';
            const hasCallGraph = callGraphCapability !== 'none';

            // Include node if: (1) its file supports a call graph, AND (2) its file is watched or no filter, OR (3) it's external
            if (hasCallGraph && (!watchedFiles || watchedFiles.has(node.fileId) || isExternal)) {
                callNodes.set(node.id, {
                    id: node.id,
                    kind: node.kind as 'function' | 'class' | 'method',
                    label: node.name,
                    fileId: node.fileId,
                    // PC-04: bake the capability onto the node so the browser
                    // can badge 'heuristic' nodes without importing parser/config.
                    callGraph: callGraphCapability
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
