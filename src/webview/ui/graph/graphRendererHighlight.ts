/**
 * Pure highlight helpers for `GraphRenderer`.
 *
 * Extracted from `graph/GraphRenderer.ts` (Loop 22 file-size split).
 * Pure browser code — no node/vscode imports.
 *
 * `highlightFolder` and `highlightFile` shared an identical body: collect
 * the direct neighbors of a node group, highlight the group + neighbors,
 * then highlight the connecting edges. That body lives here as a free
 * function; the renderer threads its child renderers and edge list in.
 */

import { VisEdge } from '../types';

/** Subset of `NodeRenderer` used when highlighting a container. */
export interface NodeHighlighter {
    highlightNodesInFolderWithNeighbors(path: string, neighbors: Set<string>): void;
}

/** Subset of `EdgeRenderer` used when collecting + highlighting neighbors. */
export interface EdgeHighlighter {
    getNeighbors(nodeId: string, edges: VisEdge[]): Set<string>;
    highlightEdgesForNodes(nodeIds: Set<string>): void;
}

/**
 * Collect the direct neighbors of `nodeIds` that fall OUTSIDE the group.
 * Pure — `getNeighbors` is supplied by the caller (the edge renderer).
 */
export function collectExternalNeighbors(
    nodeIds: Set<string>,
    edges: VisEdge[],
    getNeighbors: (nodeId: string, edges: VisEdge[]) => Set<string>,
): Set<string> {
    const neighbors = new Set<string>();
    for (const nodeId of nodeIds) {
        const nodeNeighbors = getNeighbors(nodeId, edges);
        for (const n of nodeNeighbors) {
            if (!nodeIds.has(n)) {
                neighbors.add(n);
            }
        }
    }
    return neighbors;
}

/**
 * Highlight a container (folder OR file) and its direct neighbors, then the
 * connecting edges. Byte-for-byte the shared body of the old
 * `highlightFolder`/`highlightFile` (minus the per-method `clearHighlight`
 * + group highlight, which the renderer still owns).
 */
export function highlightContainerNodes(
    path: string,
    nodesInContainer: Set<string>,
    edges: VisEdge[],
    nodeRenderer: NodeHighlighter,
    edgeRenderer: EdgeHighlighter,
): void {
    const neighbors = collectExternalNeighbors(
        nodesInContainer,
        edges,
        (id, e) => edgeRenderer.getNeighbors(id, e),
    );

    // Highlight nodes in the container and their neighbors.
    nodeRenderer.highlightNodesInFolderWithNeighbors(path, neighbors);

    // Highlight edges connected to nodes in the container.
    edgeRenderer.highlightEdgesForNodes(nodesInContainer);
}
