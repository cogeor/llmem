/**
 * Edge List Storage
 *
 * Split storage for import and call graph edges.
 * Import edges are stored in import-edgelist.json
 * Call edges are stored in call-edgelist.json
 *
 * Optimized for in-memory operations with periodic disk persistence.
 *
 * Loop 07: `WorkspaceIO` is now a *required* constructor argument. All
 * persistence routes through it; the legacy direct-`fs.*` fallback was
 * deleted with the back-compat branches in `load`/`save`.
 */

import * as path from 'path';

import {
    EdgeListData,
    EdgeListLoadError,
    NodeEntry,
    EdgeEntry,
    createEmptyEdgeList,
    loadEdgeListData,
} from './edgelist-schema';
import { createLogger, type Logger } from '../common/logger';
import { WorkspaceIO } from '../workspace/workspace-io';

// ============================================================================
// Re-exports — the schema module is the single source of truth for these
// types. Loop 16 keeps the public surface byte-compatible with the old
// hand-typed interfaces by re-exporting from here.
// ============================================================================

export type { EdgeListData, NodeEntry, EdgeEntry } from './edgelist-schema';
export { EdgeListLoadError } from './edgelist-schema';

// ============================================================================
// Constants
// ============================================================================

const IMPORT_EDGELIST_FILENAME = 'import-edgelist.json';
const CALL_EDGELIST_FILENAME = 'call-edgelist.json';

// ============================================================================
// Base EdgeListStore (shared logic)
// ============================================================================

abstract class BaseEdgeListStore {
    protected data: EdgeListData;
    protected filePath: string;
    protected dirty: boolean = false;
    protected readonly edgeKind: 'import' | 'call';
    protected readonly log: Logger;
    /**
     * Loop 07: required realpath-strong I/O surface. All persistence
     * routes through it; the legacy direct-`fs.*` fallback was removed.
     */
    protected readonly io: WorkspaceIO;
    /** Edge-list filename relative to the workspace root. */
    protected readonly relPath: string;

    constructor(
        artifactRoot: string,
        filename: string,
        edgeKind: 'import' | 'call',
        io: WorkspaceIO,
        logger?: Logger,
    ) {
        this.filePath = path.join(artifactRoot, filename);
        this.edgeKind = edgeKind;
        this.data = this.createEmpty();
        // Loop 20: scope per concrete subclass (ImportEdgeListStore /
        // CallEdgeListStore). The factory default keeps this internal so
        // call-sites don't need to thread a logger through.
        this.log = logger ?? createLogger(this.constructor.name);
        this.io = io;
        this.relPath = path.relative(this.io.getRealRoot(), this.filePath);
    }

    protected createEmpty(): EdgeListData {
        return createEmptyEdgeList();
    }

    // ========================================================================
    // Persistence
    // ========================================================================

    async load(): Promise<void> {
        if (!(await this.io.exists(this.relPath))) {
            this.data = createEmptyEdgeList();
            this.dirty = false;
            return;
        }
        let raw: unknown;
        try {
            const content = await this.io.readFile(this.relPath, 'utf-8');
            raw = JSON.parse(content);
        } catch (e) {
            throw new EdgeListLoadError(
                this.filePath,
                'parse-error',
                `JSON.parse failed: ${(e as Error).message}`,
                e,
            );
        }
        // loadEdgeListData throws EdgeListLoadError on schema failure — the
        // throw is the louder, more actionable signal that replaces the
        // pre-Loop-16 silent reset.
        this.data = loadEdgeListData(raw, this.filePath);
        this.dirty = false;
    }

    async save(): Promise<void> {
        if (!this.dirty) {
            this.log.debug('No changes to save');
            return;
        }

        try {
            this.data.timestamp = new Date().toISOString();
            const content = JSON.stringify(this.data, null, 2);

            // mkdirRecursive is idempotent when the parent already exists,
            // so no `existsSync` pre-check is needed.
            await this.io.mkdirRecursive(path.dirname(this.relPath));
            await this.io.writeFile(this.relPath, content);

            this.log.debug('Saved edge list', {
                nodes: this.data.nodes.length,
                edges: this.data.edges.length,
            });
            this.dirty = false;
        } catch (e) {
            this.log.error('Failed to save', {
                error: e instanceof Error ? e.message : String(e),
            });
            throw e;
        }
    }

    isDirty(): boolean {
        return this.dirty;
    }

    // ========================================================================
    // Node Operations
    // ========================================================================

    addNode(node: NodeEntry): void {
        const idx = this.data.nodes.findIndex(n => n.id === node.id);
        if (idx >= 0) {
            this.data.nodes[idx] = node;
        } else {
            this.data.nodes.push(node);
        }
        this.dirty = true;
    }

    addNodes(nodes: NodeEntry[]): void {
        for (const node of nodes) {
            this.addNode(node);
        }
    }

    removeNodesByFile(fileId: string): void {
        const before = this.data.nodes.length;
        this.data.nodes = this.data.nodes.filter(n => n.fileId !== fileId);
        if (this.data.nodes.length !== before) {
            this.dirty = true;
        }
    }

    getNodes(): NodeEntry[] {
        return this.data.nodes;
    }

    getNodesByFile(fileId: string): NodeEntry[] {
        return this.data.nodes.filter(n => n.fileId === fileId);
    }

    /**
     * Get all nodes within a folder (or exact file match).
     * Works for both folder paths and file paths.
     */
    getNodesByFolder(folderPath: string): NodeEntry[] {
        return this.data.nodes.filter(n =>
            n.fileId === folderPath ||
            n.fileId.startsWith(folderPath + '/')
        );
    }

    // ========================================================================
    // Edge Operations
    // ========================================================================

    addEdge(edge: EdgeEntry): void {
        // Ensure edge kind matches this store
        if (edge.kind !== this.edgeKind) {
            this.log.warn('Ignoring edge with mismatched kind', {
                edgeKind: edge.kind,
                expected: this.edgeKind,
            });
            return;
        }

        const exists = this.data.edges.some(
            e => e.source === edge.source && e.target === edge.target
        );
        if (!exists) {
            this.data.edges.push(edge);
            this.dirty = true;
        }
    }

    addEdges(edges: EdgeEntry[]): void {
        for (const edge of edges) {
            this.addEdge(edge);
        }
    }

    removeEdgesBySourceFile(fileId: string): void {
        const before = this.data.edges.length;
        this.data.edges = this.data.edges.filter(e => {
            // For import edges: source is the file ID.
            // For call edges: source is an entity graph-ID; see src/core/ids.ts.
            return !e.source.startsWith(fileId);
        });
        if (this.data.edges.length !== before) {
            this.dirty = true;
        }
    }

    getEdges(): EdgeEntry[] {
        return this.data.edges;
    }

    // ========================================================================
    // Bulk Operations
    // ========================================================================

    updateFile(fileId: string, nodes: NodeEntry[], edges: EdgeEntry[]): void {
        this.removeNodesByFile(fileId);
        this.removeEdgesBySourceFile(fileId);
        this.addNodes(nodes);
        this.addEdges(edges);
    }

    clear(): void {
        this.data = this.createEmpty();
        this.dirty = true;
    }

    /**
     * Remove all nodes and edges for a given folder path (or file path).
     * Handles both exact file matches and folder prefix matches.
     */
    removeByFolder(folderPath: string): void {
        const normalizedPath = folderPath.replace(/\\/g, '/');

        // Remove nodes in this folder/file
        const beforeNodes = this.data.nodes.length;
        this.data.nodes = this.data.nodes.filter(n => {
            const normalizedFileId = n.fileId.replace(/\\/g, '/');
            return normalizedFileId !== normalizedPath &&
                !normalizedFileId.startsWith(normalizedPath + '/');
        });

        // Remove edges with sources in this folder/file. Loop 03 removed a
        // dead `+ '#'` defensive prefix here: no node ID has ever contained
        // '#' (the canonical separator is the ENTITY_SEPARATOR exported
        // from src/core/ids.ts).
        const beforeEdges = this.data.edges.length;
        this.data.edges = this.data.edges.filter(e => {
            const normalizedSource = e.source.replace(/\\/g, '/');
            return !normalizedSource.startsWith(normalizedPath + '/') &&
                normalizedSource !== normalizedPath;
        });

        if (this.data.nodes.length !== beforeNodes || this.data.edges.length !== beforeEdges) {
            this.dirty = true;
            this.log.debug('Removed data', {
                path: normalizedPath,
                nodes: beforeNodes - this.data.nodes.length,
                edges: beforeEdges - this.data.edges.length,
            });
        }
    }

    getData(): EdgeListData {
        return this.data;
    }

    getStats(): { nodes: number; edges: number } {
        return {
            nodes: this.data.nodes.length,
            edges: this.data.edges.length
        };
    }
}

// ============================================================================
// ImportEdgeListStore - for file-to-file import relationships
// ============================================================================

/**
 * Stores and manages file-to-file import relationships.
 *
 * Each edge represents one file importing another. Nodes represent source files.
 * Persisted to `import-edgelist.json` in the artifact root.
 *
 * Typical usage:
 * ```typescript
 * const store = new ImportEdgeListStore(artifactRoot, io);
 * await store.load();
 * store.addEdge({ source: 'src/a.ts', target: 'src/b.ts', kind: 'import' });
 * await store.save();
 * ```
 */
export class ImportEdgeListStore extends BaseEdgeListStore {
    constructor(artifactRoot: string, io: WorkspaceIO, logger?: Logger) {
        super(artifactRoot, IMPORT_EDGELIST_FILENAME, 'import', io, logger);
    }
}

// ============================================================================
// CallEdgeListStore - for entity-to-entity call relationships
// ============================================================================

/**
 * Stores and manages function/entity call relationships.
 *
 * Each edge represents one code entity (function, method, arrow function) calling
 * another. Nodes represent named entities scoped to their containing file.
 * Persisted to `call-edgelist.json` in the artifact root.
 *
 * Node IDs are constructed by `makeEntityId` in src/core/ids.ts.
 *
 * Typical usage:
 * ```typescript
 * import { makeEntityId } from '../core/ids';
 * const store = new CallEdgeListStore(artifactRoot, io);
 * await store.load();
 * store.addEdge({
 *     source: makeEntityId('src/a.ts', 'foo'),
 *     target: makeEntityId('src/b.ts', 'bar'),
 *     kind: 'call'
 * });
 * await store.save();
 * ```
 */
export class CallEdgeListStore extends BaseEdgeListStore {
    constructor(artifactRoot: string, io: WorkspaceIO, logger?: Logger) {
        super(artifactRoot, CALL_EDGELIST_FILENAME, 'call', io, logger);
    }
}

