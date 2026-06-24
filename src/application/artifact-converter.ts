/**
 * Converts FileArtifact (from extractors) to EdgeList entries.
 *
 * This bridges the parsing layer to the edge list storage. It lives in
 * `src/application/` (Loop 12) BECAUSE its input is the parser's FileArtifact
 * and its output is the graph's edge-list — it is a parser→graph bridge, and
 * the application layer is the only layer allowed to depend on both. Moving it
 * here removed the two `graph → parser` import edges that the layer matrix
 * previously allow-listed.
 */

import { FileArtifact } from '../parser/types';
import { NodeEntry, EdgeEntry } from '../graph/edgelist';
import { getCallGraphCapability } from '../parser/config';
import { makeEntityId, isExternalModuleId } from '../core/ids';
import { resolveImportTarget, resolveCallToEdge } from './artifact-resolvers';

export interface ConversionResult {
    nodes: NodeEntry[];
    importEdges: EdgeEntry[];  // kind: 'import' - file-to-file
    callEdges: EdgeEntry[];    // kind: 'call' - entity-to-entity
}

/** Options for {@link artifactToEdgeList}. */
export interface ArtifactToEdgeListOptions {
    /**
     * When true, omit external-module import edges/nodes entirely: the
     * external-import branch is skipped, so no external module node is created
     * and no external import edge is pushed. The file node, entity nodes,
     * INTERNAL import edges, and ALL call edges are emitted unchanged.
     *
     * DEFAULT `false` (back-compat): direct/script/test/viewer callers keep
     * emitting externals unless they opt in. The scan path threads the
     * workspace config (`internalOnly`, default true) through to flip this on.
     */
    internalOnly?: boolean;
}

/**
 * Convert a FileArtifact to edge list entries.
 *
 * @param artifact The parsed file artifact from an extractor
 * @param fileId The normalized file ID (relative path)
 * @param options Optional conversion knobs ({@link ArtifactToEdgeListOptions}).
 * @returns Nodes and edges for the edge list
 */
export function artifactToEdgeList(
    artifact: FileArtifact,
    fileId: string,
    options: ArtifactToEdgeListOptions = {},
): ConversionResult {
    const { internalOnly = false } = options;
    const nodes: NodeEntry[] = [];
    const importEdges: EdgeEntry[] = [];
    const callEdges: EdgeEntry[] = [];
    const externalModules = new Set<string>();

    // PC-04 / Loop 12: persist the scanned file's call-graph capability onto the
    // nodes it owns (the file node + its entity nodes). The graph builder
    // (graph/index.ts) now reads `node.callGraph` instead of re-deriving it from
    // parser/config — that is what removed the second `graph → parser` edge.
    // Only THIS file's nodes are stamped; external/synthesized module nodes
    // (created for imports of OTHER files below) are left unstamped, which the
    // builder treats as 'none' (they are never real call-graph entities here).
    const fileCallGraph = getCallGraphCapability(fileId);

    // 0. Always create a file node (ensures import edges work for files with only types/interfaces)
    nodes.push({
        id: fileId,
        name: fileId.split('/').pop() || fileId,
        kind: 'file',
        fileId,
        callGraph: fileCallGraph
    });

    // 1. Create entity nodes
    for (const entity of artifact.entities) {
        const nodeId = makeEntityId(fileId, entity.name);

        // Map entity kind to node kind
        let kind: NodeEntry['kind'] = 'function';
        if (entity.kind === 'class') kind = 'class';
        else if (entity.kind === 'method') kind = 'method';
        else if (entity.kind === 'arrow') kind = 'arrow';
        else if (entity.kind === 'const') kind = 'const';

        nodes.push({
            id: nodeId,
            name: entity.name,
            kind,
            fileId,
            callGraph: fileCallGraph
        });

        // 2. Create call edges from this entity
        if (entity.calls) {
            for (const call of entity.calls) {
                const callEdge = resolveCallToEdge(fileId, nodeId, call, artifact.imports, externalModules);
                if (callEdge) {
                    callEdges.push(callEdge);
                }
            }
        }
    }

    // 3. Create import edges
    for (const imp of artifact.imports) {
        const targetFileId = resolveImportTarget(fileId, imp);

        if (targetFileId) {
            // Loop 16: route through the contract's external classifier.
            const isExternal = isExternalModuleId(targetFileId);

            if (isExternal && internalOnly) {
                // internal-only mode (Loop 03): drop external-module import
                // edges/nodes entirely. No external node, no external edge,
                // and crucially NOT routed into the internal branch below
                // (an external id like `react` has no '/' so it would
                // otherwise be mistaken for an internal target).
                continue;
            }

            if (isExternal) {
                // External module import (e.g., pathlib, os, json)
                externalModules.add(targetFileId);

                // Create module node if not exists
                const moduleNodeExists = nodes.some(n => n.id === targetFileId);
                if (!moduleNodeExists) {
                    nodes.push({
                        id: targetFileId,
                        name: targetFileId,
                        kind: 'file', // External modules shown as file nodes
                        fileId: targetFileId
                    });
                }

                // Create import edge to module
                importEdges.push({
                    source: fileId,
                    target: targetFileId,
                    kind: 'import',
                    typeOnly: imp.typeOnly
                });

                // Create nodes for imported classes/functions from external modules
                for (const spec of imp.specifiers) {
                    if (spec.name !== '*') {
                        const entityNodeId = makeEntityId(targetFileId, spec.name);
                        const entityNodeExists = nodes.some(n => n.id === entityNodeId);

                        if (!entityNodeExists) {
                            nodes.push({
                                id: entityNodeId,
                                name: spec.name,
                                kind: 'function', // Could be class, function, etc.
                                fileId: targetFileId
                            });
                        }
                    }
                }
            } else if (!targetFileId.includes('node_modules')) {
                // Internal import (workspace file)
                importEdges.push({
                    source: fileId,
                    target: targetFileId,
                    kind: 'import',
                    typeOnly: imp.typeOnly
                });
            }
        }
    }

    return { nodes, importEdges, callEdges };
}

/**
 * Convert multiple artifacts to edge list entries.
 * Useful for batch processing.
 */
export function artifactsToEdgeList(artifacts: Array<{ fileId: string; artifact: FileArtifact }>): ConversionResult {
    const allNodes: NodeEntry[] = [];
    const allImportEdges: EdgeEntry[] = [];
    const allCallEdges: EdgeEntry[] = [];

    for (const { fileId, artifact } of artifacts) {
        const { nodes, importEdges, callEdges } = artifactToEdgeList(artifact, fileId);
        allNodes.push(...nodes);
        allImportEdges.push(...importEdges);
        allCallEdges.push(...callEdges);
    }

    return { nodes: allNodes, importEdges: allImportEdges, callEdges: allCallEdges };
}
