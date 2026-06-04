/**
 * Edge-list mutation primitives (Loop 14 extraction of `graph/edgelist.ts`).
 *
 * Pure functions operating on an `EdgeListData` envelope. Each returns a
 * boolean indicating whether the data actually changed, so the calling
 * `BaseEdgeListStore` can flip its `dirty` flag without duplicating the
 * before/after length bookkeeping. Behavior is byte-for-byte identical to
 * the original in-class implementations — only the location moved.
 *
 * These operate on plain data and import no logger / I/O, keeping the
 * mutation logic trivially unit-testable in isolation.
 */

import { EdgeListData, NodeEntry, EdgeEntry } from '../edgelist-schema';
import { ENTITY_SEPARATOR } from '../../core/ids';

// ============================================================================
// Node operations
// ============================================================================

/** Upsert a single node by id. Always marks the store dirty (matches the
 * original `addNode`, which set `dirty = true` unconditionally). */
export function addNode(data: EdgeListData, node: NodeEntry): void {
    const idx = data.nodes.findIndex(n => n.id === node.id);
    if (idx >= 0) {
        data.nodes[idx] = node;
    } else {
        data.nodes.push(node);
    }
}

/** Remove all nodes belonging to a file. Returns true if any were removed. */
export function removeNodesByFile(data: EdgeListData, fileId: string): boolean {
    const before = data.nodes.length;
    data.nodes = data.nodes.filter(n => n.fileId !== fileId);
    return data.nodes.length !== before;
}

// ============================================================================
// Edge operations
// ============================================================================

/**
 * Insert an edge if (source,target) is not already present and the edge kind
 * matches `edgeKind`. Returns 'added' | 'duplicate' | 'mismatch' so the
 * caller can preserve the original logging on a kind mismatch.
 */
export function addEdge(
    data: EdgeListData,
    edge: EdgeEntry,
    edgeKind: 'import' | 'call',
): 'added' | 'duplicate' | 'mismatch' {
    // Ensure edge kind matches this store
    if (edge.kind !== edgeKind) {
        return 'mismatch';
    }

    const exists = data.edges.some(
        e => e.source === edge.source && e.target === edge.target
    );
    if (!exists) {
        data.edges.push(edge);
        return 'added';
    }
    return 'duplicate';
}

/** Remove edges whose source starts with `fileId`. Returns true if any removed. */
export function removeEdgesBySourceFile(data: EdgeListData, fileId: string): boolean {
    const before = data.edges.length;
    data.edges = data.edges.filter(e => {
        // For import edges: source is the file ID.
        // For call edges: source is an entity graph-ID; see src/core/ids.ts.
        return !e.source.startsWith(fileId);
    });
    return data.edges.length !== before;
}

// ============================================================================
// Folder / file removal
// ============================================================================

export interface RemovalCounts {
    nodes: number;
    edges: number;
}

/**
 * Remove all nodes and edges for a given folder path (or file path).
 * Handles both exact file matches and folder prefix matches.
 *
 * Returns the count of nodes/edges removed so the caller can decide whether
 * to mark dirty and emit its debug breadcrumb.
 */
export function removeByFolder(data: EdgeListData, folderPath: string): RemovalCounts {
    const normalizedPath = folderPath.replace(/\\/g, '/');

    // Remove nodes in this folder/file
    const beforeNodes = data.nodes.length;
    data.nodes = data.nodes.filter(n => {
        const normalizedFileId = n.fileId.replace(/\\/g, '/');
        return normalizedFileId !== normalizedPath &&
            !normalizedFileId.startsWith(normalizedPath + '/');
    });

    // Remove edges with sources in this folder/file. Loop 03 removed a
    // dead `+ '#'` defensive prefix here: no node ID has ever contained
    // '#' (the canonical separator is the ENTITY_SEPARATOR exported
    // from src/core/ids.ts).
    //
    // LS-06: call-edge sources are ENTITY ids (`<fileId><sep><entity>`,
    // sep = ENTITY_SEPARATOR from the core/ids contract module), so a
    // single-FILE removal must also drop `<path><sep>*` sources — the bare
    // `<path>/`-prefix + exact-match checks miss them and would leave a
    // stale call edge after a file is deleted/changed. The separator
    // boundary is source-side only and never matches a real folder path
    // (no source is `<folder><sep>*`), so it is safe for the folder case
    // too. (LS-07 will add a dedicated removeByFile that ALSO purges
    // by-target.)
    const entityBoundary = normalizedPath + ENTITY_SEPARATOR;
    const beforeEdges = data.edges.length;
    data.edges = data.edges.filter(e => {
        const normalizedSource = e.source.replace(/\\/g, '/');
        return !normalizedSource.startsWith(normalizedPath + '/') &&
            !normalizedSource.startsWith(entityBoundary) &&
            normalizedSource !== normalizedPath;
    });

    return {
        nodes: beforeNodes - data.nodes.length,
        edges: beforeEdges - data.edges.length,
    };
}

/**
 * Remove all nodes and edges belonging to a SINGLE file (LS-07).
 *
 * Unlike `removeByFolder` (which filters edges BY SOURCE only and uses a
 * folder-prefix match), this is precise to one file and purges edges where
 * the file is the SOURCE *or* the TARGET. That matters for a deleted file
 * with INCOMING imports/calls: a source-only purge leaves a stale inbound
 * edge pointing at the now-gone file.
 *
 * Target/source resolution: edge `source`/`target` are graph IDs. They are
 * either a bare file ID (`src/a.ts`) or an entity ID (`src/a.ts::foo`,
 * separator = ENTITY_SEPARATOR). We strip an entity ID back to its owning
 * file ID before comparing, so both file-id edges (import graph) and
 * entity-id edges (call graph) are handled. External-module endpoints
 * (no slash, no separator) never equal a workspace file path and are left
 * untouched.
 */
export function removeByFile(data: EdgeListData, relPath: string): RemovalCounts {
    const normalizedPath = relPath.replace(/\\/g, '/');

    // Strip an entity graph-ID back to its owning file ID; bare file/
    // external IDs pass through unchanged.
    const fileIdOf = (graphId: string): string => {
        const normalized = graphId.replace(/\\/g, '/');
        const idx = normalized.indexOf(ENTITY_SEPARATOR);
        return idx >= 0 ? normalized.slice(0, idx) : normalized;
    };

    const beforeNodes = data.nodes.length;
    data.nodes = data.nodes.filter(
        n => n.fileId.replace(/\\/g, '/') !== normalizedPath,
    );

    const beforeEdges = data.edges.length;
    data.edges = data.edges.filter(
        e => fileIdOf(e.source) !== normalizedPath && fileIdOf(e.target) !== normalizedPath,
    );

    return {
        nodes: beforeNodes - data.nodes.length,
        edges: beforeEdges - data.edges.length,
    };
}
