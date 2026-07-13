/**
 * BaseEdgeListStore — shared persistence + mutation surface for the import
 * and call edge stores (Loop 14 extraction of `graph/edgelist.ts`).
 *
 * Loop 07: `WorkspaceIO` is a *required* constructor argument. All
 * persistence routes through it; the legacy direct-`fs.*` fallback was
 * deleted with the back-compat branches in `load`/`save`.
 *
 * The node/edge mutation bodies live in `./mutations` as pure functions over
 * `EdgeListData`; the methods here delegate and own only the `dirty`-flag and
 * logging bookkeeping.
 */

import * as path from 'path';

import {
    EdgeListData,
    EdgeListLoadError,
    SchemaMismatchError,
    NodeEntry,
    EdgeEntry,
    createEmptyEdgeList,
    loadEdgeListData,
    EDGELIST_SCHEMA_VERSION,
    EDGELIST_RESOLVER_VERSION,
} from '../edgelist-schema';
import { createLogger, type StructuredLogger } from '../../common/logger';
import { WorkspaceIO } from '../../workspace/workspace-io';
import { writeFileAtomic } from './atomic-write';
import { withWriteLock } from './lock';
import { runEdgeStoreTransaction } from './transaction';
import * as mutations from './mutations';

export abstract class BaseEdgeListStore {
    protected data: EdgeListData;
    protected filePath: string;
    protected dirty: boolean = false;
    protected readonly edgeKind: 'import' | 'call';
    protected readonly log: StructuredLogger;
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
        logger?: StructuredLogger,
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
            // Mirrors `clear()`: in-memory state diverges from disk (file
            // does not exist yet), so the next `save()` must flush an
            // empty envelope. Without this, scans that find 0 supported
            // files leave the artifact directory empty and downstream
            // `generateGraph` throws "Edge lists not found".
            this.dirty = true;
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
        //
        // Loop 13 (codebase-quality-v2): SchemaMismatchError is a typed
        // subclass that callsites use to trigger `scanFolderRecursive`.
        // Emit a warn-level breadcrumb naming the file BEFORE re-throwing
        // so production logs carry the (old, new) version pair even when
        // the catching layer logs only a generic message.
        try {
            this.data = loadEdgeListData(raw, this.filePath);
        } catch (e) {
            if (e instanceof SchemaMismatchError) {
                this.log.warn('Edge-list schema mismatch — caller must rescan', {
                    file: this.filePath,
                    old: {
                        schemaVersion: e.oldSchemaVersion,
                        resolverVersion: e.oldResolverVersion,
                    },
                    new: {
                        schemaVersion: EDGELIST_SCHEMA_VERSION,
                        resolverVersion: EDGELIST_RESOLVER_VERSION,
                    },
                });
            }
            throw e;
        }
        this.dirty = false;
    }

    async save(): Promise<void> {
        // Loop LS-10: serialize the WHOLE save critical section per target
        // file so same-process concurrent writers can't interleave and lose
        // updates. Keyed by the canonical absolute path so every store
        // writing this file (across instances) shares one queue. Only the
        // top-level save() acquires the lock — nested helpers must not, or
        // they would deadlock (the queue is non-reentrant).
        return withWriteLock(this.lockKey(), () => this.saveLocked());
    }

    /**
     * Canonical per-file lock key — every store instance writing the SAME
     * target file in this process shares one `withWriteLock` queue.
     */
    private lockKey(): string {
        return this.io.resolve(this.relPath);
    }

    /**
     * Atomic `load → mutate → save` transaction (Loop K2).
     *
     * Acquires the per-file write lock ONCE and, inside the held section,
     * runs `load()` (a pure read — it never re-acquires the lock), then the
     * caller's `fn` (which mutates via this store's mutation methods), then
     * `saveLocked()` to publish (the NON-locking body — calling the public
     * `save()` here would re-acquire the key and DEADLOCK). Two concurrent
     * transactions on the same file serialize: the second sees the first's
     * published state, so neither's mutation is lost (the hazard the bare
     * `save()` lock could not cover, since callers did `load(); mutate();
     * save()` with the load OUTSIDE the lock). The primitive lives in
     * `./transaction`; see its REENTRANCY CONTRACT note.
     */
    async withTransaction<T>(fn: () => T | Promise<T>): Promise<T> {
        return runEdgeStoreTransaction(
            this.lockKey(),
            () => this.load(),
            () => this.saveLocked(),
            fn,
        );
    }

    /**
     * The serialized save body. Runs under `withWriteLock` (via `save`) so
     * it never overlaps another save to the same file in this process.
     * Publishes via `writeFileAtomic` (temp-write + rename) so a torn write
     * can't leave a truncated file for the next reader.
     */
    private async saveLocked(): Promise<void> {
        if (!this.dirty) {
            this.log.debug('No changes to save');
            return;
        }

        try {
            this.data.timestamp = new Date().toISOString();
            const content = JSON.stringify(this.data, null, 2);

            // mkdirRecursive is idempotent when the parent already exists,
            // so no `existsSync` pre-check is needed. It also guarantees the
            // temp file's parent dir exists before writeFileAtomic runs.
            await this.io.mkdirRecursive(path.dirname(this.relPath));
            // Atomic publish: temp file in the same dir, then rename over
            // the target (see writeFileAtomic). Prevents TORN reads.
            await writeFileAtomic(this.io, this.relPath, content);

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
        mutations.addNode(this.data, node);
        this.dirty = true;
    }

    addNodes(nodes: NodeEntry[]): void {
        for (const node of nodes) {
            this.addNode(node);
        }
    }

    removeNodesByFile(fileId: string): void {
        if (mutations.removeNodesByFile(this.data, fileId)) {
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
        const result = mutations.addEdge(this.data, edge, this.edgeKind);
        if (result === 'mismatch') {
            this.log.warn('Ignoring edge with mismatched kind', {
                edgeKind: edge.kind,
                expected: this.edgeKind,
            });
            return;
        }
        if (result === 'added') {
            this.dirty = true;
        }
    }

    addEdges(edges: EdgeEntry[]): void {
        for (const edge of edges) {
            this.addEdge(edge);
        }
    }

    getEdges(): EdgeEntry[] {
        return this.data.edges;
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
        const removed = mutations.removeByFolder(this.data, folderPath);
        if (removed.nodes !== 0 || removed.edges !== 0) {
            this.dirty = true;
            this.log.debug('Removed data', {
                path: folderPath.replace(/\\/g, '/'),
                nodes: removed.nodes,
                edges: removed.edges,
            });
        }
    }

    /**
     * Remove all nodes and edges belonging to a SINGLE file (LS-07).
     *
     * Unlike `removeByFolder` (which filters edges BY SOURCE only and uses a
     * folder-prefix match), this is precise to one file and purges edges where
     * the file is the SOURCE *or* the TARGET. That matters for a deleted file
     * with INCOMING imports/calls: a source-only purge leaves a stale inbound
     * edge pointing at the now-gone file.
     */
    removeByFile(relPath: string): void {
        const removed = mutations.removeByFile(this.data, relPath);
        if (removed.nodes !== 0 || removed.edges !== 0) {
            this.dirty = true;
            this.log.debug('Removed file data', {
                path: relPath.replace(/\\/g, '/'),
                nodes: removed.nodes,
                edges: removed.edges,
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
