/**
 * Standalone clone edge-list store (Loop 06).
 *
 * Persists clone edges to `clone-edgelist.json` with its OWN schema/version —
 * deliberately NOT a `BaseEdgeListStore` subclass and NOT routed through the
 * shared `EdgeKindSchema` / `EdgeListV2Schema` envelope (which is hard-wired to
 * `edgeKind: 'import'|'call'` and `EdgeEntrySchema`, neither of which carries
 * `similarity`/`cloneType`/`severity`). Keeping the clone edge shape in its own
 * tiny store isolates the new payload and leaves `EDGELIST_SCHEMA_VERSION`
 * (currently 4) and `EdgeKindSchema` (`['import','call']`) untouched.
 *
 * Layer: GRAPH. It imports only `zod`, `path`, `WorkspaceIO`, the logger, and
 * the atomic-write helper — NO application/parser imports (graph must not import
 * parser; the parsing/normalization happens in the application analyzer, which
 * hands finished edges to `setEdges`).
 *
 * Determinism: `setEdges` sorts edges by `source` then `target` BEFORE storing,
 * so `clone-edgelist.json` is diff-stable run-to-run. The `timestamp` field is
 * metadata only (mirrors the import/call envelope, git-ignored under
 * `.llmem/graph`); the diff-relevant payload is the SORTED edge array.
 */

import * as path from 'path';
import { z } from 'zod';

import { WorkspaceIO } from '../../workspace/workspace-io';
import { createLogger, type StructuredLogger } from '../../common/logger';
import { writeFileAtomic } from './atomic-write';

/**
 * Own schema version — independent of `EDGELIST_SCHEMA_VERSION`. Bumped 1 → 2 by
 * Loop 07: the edge shape gained `cloneType:'shared-literal'` + `sharedKind`. A
 * stale v1 file fails the `schemaVersion` literal check and degrades to empty
 * (recomputed next run) — consistent with the analysis-cache v1→v2 migration.
 */
export const CLONE_EDGELIST_SCHEMA_VERSION = 2;

/** Clone filename under the artifact root. */
const CLONE_EDGELIST_FILENAME = 'clone-edgelist.json';

/** Clone strength dimension. Widened in Loop 07 (shared-literal payload). */
export type CloneType = 'exact-body' | 'shared-literal';

export const CloneEdgeSchema = z.object({
    source: z.string().min(1), // entity id <fileId>::<name>
    target: z.string().min(1),
    kind: z.literal('clone'),
    similarity: z.number(), // 1 for exact-body
    cloneType: z.enum(['exact-body', 'shared-literal']),
    /** For `shared-literal` edges: which payload kind is shared (Loop 07). */
    sharedKind: z.enum(['string', 'array', 'regex', 'numeric']).optional(),
    severity: z.enum(['high', 'medium', 'low']),
});
export type CloneEdge = z.infer<typeof CloneEdgeSchema>;

export const CloneEdgeListSchema = z.object({
    schemaVersion: z.literal(CLONE_EDGELIST_SCHEMA_VERSION),
    timestamp: z.string(),
    edges: z.array(CloneEdgeSchema),
});
export type CloneEdgeListData = z.infer<typeof CloneEdgeListSchema>;

/** A fresh empty clone-edge-list envelope. */
function emptyData(): CloneEdgeListData {
    return {
        schemaVersion: CLONE_EDGELIST_SCHEMA_VERSION,
        timestamp: new Date(0).toISOString(),
        edges: [],
    };
}

/**
 * Deterministic edge order: by `source`, then `target` (locale-stable). Pure;
 * does not mutate the input.
 */
function sortEdges(edges: CloneEdge[]): CloneEdge[] {
    return [...edges].sort(
        (a, b) =>
            a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
    );
}

/**
 * Standalone clone-edge store. Mirrors the base store's load/save discipline
 * (tolerant load, atomic write, sorted/deterministic data) without subclassing
 * it.
 */
export class CloneEdgeListStore {
    private data: CloneEdgeListData;
    private dirty = false;
    private readonly relPath: string;
    private readonly log: StructuredLogger;

    constructor(
        artifactRoot: string,
        private readonly io: WorkspaceIO,
        logger?: StructuredLogger,
    ) {
        const filePath = path.join(artifactRoot, CLONE_EDGELIST_FILENAME);
        this.relPath = path.relative(this.io.getRealRoot(), filePath);
        this.data = emptyData();
        this.log = logger ?? createLogger('CloneEdgeListStore');
    }

    /**
     * Tolerant load: a MISSING file OR any parse/schema failure degrades to an
     * empty store (never throws). Mirrors the analysis-cache read tolerance.
     */
    async load(): Promise<void> {
        if (!(await this.io.exists(this.relPath))) {
            this.data = emptyData();
            this.dirty = false;
            return;
        }
        try {
            const content = await this.io.readFile(this.relPath, 'utf-8');
            const parsed = CloneEdgeListSchema.parse(JSON.parse(content));
            this.data = parsed;
            this.dirty = false;
        } catch (e) {
            this.log.warn('clone-edgelist load failed — starting empty', {
                file: this.relPath,
                error: e instanceof Error ? e.message : String(e),
            });
            this.data = emptyData();
            this.dirty = false;
        }
    }

    /** Atomic save; only writes when dirty. Re-stamps `timestamp` metadata. */
    async save(): Promise<void> {
        if (!this.dirty) {
            this.log.debug('No clone edges to save');
            return;
        }
        this.data.timestamp = new Date().toISOString();
        const content = JSON.stringify(this.data, null, 2);
        await this.io.mkdirRecursive(path.dirname(this.relPath));
        await writeFileAtomic(this.io, this.relPath, content);
        this.dirty = false;
        this.log.debug('Saved clone edge list', { edges: this.data.edges.length });
    }

    /** REPLACE-all: sort deterministically, store, mark dirty. */
    setEdges(edges: CloneEdge[]): void {
        this.data.edges = sortEdges(edges);
        this.dirty = true;
    }

    getEdges(): CloneEdge[] {
        return this.data.edges;
    }

    getData(): CloneEdgeListData {
        return this.data;
    }

    isDirty(): boolean {
        return this.dirty;
    }
}
