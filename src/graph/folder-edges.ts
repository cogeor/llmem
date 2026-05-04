/**
 * Folder-edges domain primitive (Loop 08).
 *
 * Pure aggregator that rolls file-level import + call edges up to
 * folder→folder edges, with a 90th-percentile threshold persisted on
 * the envelope. No I/O — accepts plain data and returns plain data.
 *
 * Mirrors `folder-tree.ts` for the folder-path rule (`folderOf`):
 *   - Backslashes are normalized to forward slashes.
 *   - Top-level files map to `"."`.
 *
 * Aggregation rules (from the design spec):
 *   1. Resolve each endpoint to a file ID via `fileOf`. Import-edge
 *      endpoints are already file IDs but we still pass them through so
 *      external/unknown IDs are rejected uniformly.
 *   2. Drop edges where either resolved file ID is null OR
 *      `isExternalModuleId(resolvedId)` is true.
 *   3. Compute folder pair via `folderOf`.
 *   4. Drop self-edges (cohesion lives in the tree, not the edges).
 *   5. Bucket by `(from, to, kind)` and increment a weight counter.
 *   6. Materialize edges sorted deterministically: kind asc, from asc,
 *      to asc, weight desc.
 *   7. Compute `weightP90` over the resulting edge weights using the
 *      NumPy-default linear-interpolation method (type 7).
 */

import { z } from 'zod';
import * as path from 'path';
import { isExternalModuleId } from '../core/ids';

export const FOLDER_EDGES_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const FolderEdgeKindSchema = z.enum(['import', 'call']);

export const FolderEdgeSchema = z.object({
    from: z.string(),
    to: z.string(),
    kind: FolderEdgeKindSchema,
    weight: z.number().int().positive(),
});

export const FolderEdgelistSchema = z.object({
    schemaVersion: z.literal(FOLDER_EDGES_SCHEMA_VERSION),
    timestamp: z.string(),
    edges: z.array(FolderEdgeSchema),
    weightP90: z.number().nonnegative(),
});

export type FolderEdgeKind = z.infer<typeof FolderEdgeKindSchema>;
export type FolderEdge = z.infer<typeof FolderEdgeSchema>;
export type FolderEdgelistData = z.infer<typeof FolderEdgelistSchema>;

// ---------------------------------------------------------------------------
// Builder input
// ---------------------------------------------------------------------------

export interface BuildFolderEdgesInput {
    /** File→file import edges (source/target are file IDs already). */
    importEdges: { source: string; target: string }[];
    /** Entity→entity call edges; resolve each side via `fileOf`. */
    callEdges: { source: string; target: string }[];
    /**
     * Resolve a graph ID (entity or file) to its file ID, or `null` if
     * the ID does not belong to a workspace file (external / unknown).
     */
    fileOf: (entityOrFileId: string) => string | null;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export type FolderEdgelistLoadErrorReason =
    | 'parse-error'
    | 'schema-error'
    | 'unknown-version';

export class FolderEdgelistLoadError extends Error {
    constructor(
        public readonly filePath: string,
        public readonly reason: FolderEdgelistLoadErrorReason,
        public readonly detail: string,
        cause?: unknown,
    ) {
        super(`[folder-edges] ${reason} loading ${filePath}: ${detail}`);
        this.name = 'FolderEdgelistLoadError';
        if (cause !== undefined) {
            (this as { cause?: unknown }).cause = cause;
        }
    }
}

// ---------------------------------------------------------------------------
// Folder-path helper (shared rule with folder-tree.ts)
// ---------------------------------------------------------------------------

function folderOf(fileId: string): string {
    const normalized = fileId.replaceAll('\\', '/');
    const dir = path.posix.dirname(normalized);
    return dir === '.' ? '.' : dir;
}

/**
 * Decide whether a normalized ID names a workspace file.
 *
 * Mirrors the helper in `folder-tree.ts`: keeps `isExternalModuleId` as
 * the primary gate but adds a permissive fallback so a top-level file
 * (`foo.ts`) is recognized as a workspace file. Bare module names
 * (`react`, `pathlib`) still fall through to "external".
 */
function isWorkspaceFileId(normalizedId: string): boolean {
    if (!isExternalModuleId(normalizedId)) return true;
    const dotIdx = normalizedId.lastIndexOf('.');
    return dotIdx > 0;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildFolderEdges(input: BuildFolderEdgesInput): FolderEdgelistData {
    // Map keyed on `${from}\0${to}\0${kind}`. NUL is safe — folder paths
    // cannot contain NUL on any supported FS.
    const buckets = new Map<string, { from: string; to: string; kind: FolderEdgeKind; weight: number }>();

    const accumulate = (
        rawSource: string,
        rawTarget: string,
        kind: FolderEdgeKind,
    ): void => {
        const sourceFile = input.fileOf(rawSource);
        const targetFile = input.fileOf(rawTarget);
        if (sourceFile === null || targetFile === null) return;

        const sourceNorm = sourceFile.replaceAll('\\', '/');
        const targetNorm = targetFile.replaceAll('\\', '/');
        if (!isWorkspaceFileId(sourceNorm) || !isWorkspaceFileId(targetNorm)) return;

        const from = folderOf(sourceFile);
        const to = folderOf(targetFile);
        if (from === to) return;

        const key = `${from}\0${to}\0${kind}`;
        const existing = buckets.get(key);
        if (existing) {
            existing.weight += 1;
        } else {
            buckets.set(key, { from, to, kind, weight: 1 });
        }
    };

    for (const e of input.importEdges) {
        accumulate(e.source, e.target, 'import');
    }
    for (const e of input.callEdges) {
        accumulate(e.source, e.target, 'call');
    }

    // Deterministic ordering: kind asc, from asc, to asc, weight desc.
    const edges: FolderEdge[] = Array.from(buckets.values()).sort((a, b) => {
        if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
        if (a.from !== b.from) return a.from < b.from ? -1 : 1;
        if (a.to !== b.to) return a.to < b.to ? -1 : 1;
        return b.weight - a.weight;
    });

    const weightP90 = computeWeightP90(edges.map((e) => e.weight));

    return {
        schemaVersion: FOLDER_EDGES_SCHEMA_VERSION,
        timestamp: new Date().toISOString(),
        edges,
        weightP90,
    };
}

// ---------------------------------------------------------------------------
// Percentile (named export for unit testability)
// ---------------------------------------------------------------------------

/**
 * 90th-percentile via type 7 / linear interpolation. Matches NumPy's
 * default `np.percentile` and Excel's `PERCENTILE.INC`.
 *
 *     rank = 0.9 * (n - 1)
 *     lo = floor(rank), hi = ceil(rank)
 *     return sorted[lo] + (rank - lo) * (sorted[hi] - sorted[lo])
 *
 * Edge cases:
 *   - empty input → 0
 *   - single element → that element
 *   - uniform input → the uniform value (formula collapses cleanly)
 *
 * Does not mutate the caller's array.
 */
export function computeWeightP90(weights: number[]): number {
    const n = weights.length;
    if (n === 0) return 0;
    if (n === 1) return weights[0];

    const sorted = weights.slice().sort((a, b) => a - b);
    const rank = 0.9 * (n - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (rank - lo) * (sorted[hi] - sorted[lo]);
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

export function migrateFolderEdges(raw: unknown, filePath: string): FolderEdgelistData {
    if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new FolderEdgelistLoadError(
            filePath,
            'schema-error',
            `expected an object, received ${describeType(raw)}`,
        );
    }

    const obj = raw as Record<string, unknown>;

    let candidateVersion: number;
    if (typeof obj['schemaVersion'] === 'number') {
        candidateVersion = obj['schemaVersion'];
    } else if (obj['schemaVersion'] === undefined) {
        candidateVersion = 1;
    } else {
        throw new FolderEdgelistLoadError(
            filePath,
            'unknown-version',
            String(obj['schemaVersion']),
        );
    }

    if (candidateVersion !== 1) {
        throw new FolderEdgelistLoadError(
            filePath,
            'unknown-version',
            String(candidateVersion),
        );
    }

    const candidate: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
        if (key === 'schemaVersion') continue;
        candidate[key] = value;
    }
    candidate.schemaVersion = 1;

    const result = FolderEdgelistSchema.safeParse(candidate);
    if (!result.success) {
        const detail = result.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ');
        throw new FolderEdgelistLoadError(filePath, 'schema-error', detail);
    }
    return result.data;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describeType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}
