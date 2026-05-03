/**
 * Edge-list schema (Loop 16).
 *
 * Owns the single source of truth for the persisted edge-list shape. The
 * Zod schemas double as TypeScript types via `z.infer`, replacing the
 * hand-typed interfaces that previously lived in `edgelist.ts`.
 *
 * Versioning
 * ----------
 * The on-disk integer `schemaVersion` (currently `1`) is monotonic and
 * decoupled from the legacy semver-style `version: '1.0.0'` field that
 * pre-Loop-16 production files carry. The migrator accepts:
 *   - `schemaVersion: 1` (current shape).
 *   - `version: '1.0.0'` (legacy string).
 *   - versionless documents (very old test fixtures).
 * Anything else (unknown `schemaVersion`, missing `nodes` array, etc.)
 * raises `EdgeListLoadError` with an actionable diagnostic.
 *
 * No silent reset: the previous `BaseEdgeListStore.load` swallowed schema
 * failures and reset the store to empty, which produced silent data loss
 * on the next save. The new behavior is to throw and let the caller decide.
 */

import { z } from 'zod';

export const EDGELIST_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const NodeKindSchema = z.enum([
    'file',
    'function',
    'class',
    'method',
    'arrow',
    'const',
]);

export const EdgeKindSchema = z.enum(['import', 'call']);

export const NodeEntrySchema = z.object({
    id: z.string().min(1),
    name: z.string(),
    kind: NodeKindSchema,
    fileId: z.string().min(1),
});

export const EdgeEntrySchema = z.object({
    source: z.string().min(1),
    target: z.string().min(1),
    kind: EdgeKindSchema,
});

export const EdgeListV1Schema = z.object({
    schemaVersion: z.literal(EDGELIST_SCHEMA_VERSION),
    timestamp: z.string(),
    nodes: z.array(NodeEntrySchema),
    edges: z.array(EdgeEntrySchema),
});

// ---------------------------------------------------------------------------
// Inferred types (single source of truth — re-exported from `edgelist.ts`)
// ---------------------------------------------------------------------------

export type NodeEntry = z.infer<typeof NodeEntrySchema>;
export type EdgeEntry = z.infer<typeof EdgeEntrySchema>;
export type EdgeListData = z.infer<typeof EdgeListV1Schema>;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export type EdgeListLoadErrorReason =
    | 'parse-error'
    | 'schema-error'
    | 'unknown-version';

export class EdgeListLoadError extends Error {
    constructor(
        public readonly filePath: string,
        public readonly reason: EdgeListLoadErrorReason,
        public readonly detail: string,
        cause?: unknown,
    ) {
        super(`[edgelist] ${reason} loading ${filePath}: ${detail}`);
        this.name = 'EdgeListLoadError';
        if (cause !== undefined) {
            (this as { cause?: unknown }).cause = cause;
        }
    }
}

// ---------------------------------------------------------------------------
// Empty-state factory
// ---------------------------------------------------------------------------

export function createEmptyEdgeList(): EdgeListData {
    return {
        schemaVersion: EDGELIST_SCHEMA_VERSION,
        timestamp: new Date().toISOString(),
        nodes: [],
        edges: [],
    };
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Best-effort upgrade of any prior shape to v1. Throws `EdgeListLoadError`
 * on shapes that cannot be salvaged. The migrator is a strict gate — it
 * does NOT try to repair malformed payloads.
 */
export function migrate(raw: unknown, filePath: string): EdgeListData {
    if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new EdgeListLoadError(
            filePath,
            'schema-error',
            `expected an object, received ${describeType(raw)}`,
        );
    }

    const obj = raw as Record<string, unknown>;

    // Determine candidate version. Prefer explicit `schemaVersion` (number),
    // fall back to legacy `version` (string), then versionless.
    let candidateVersion: number;
    if (typeof obj['schemaVersion'] === 'number') {
        candidateVersion = obj['schemaVersion'];
    } else if (typeof obj['version'] === 'string' && obj['version'] === '1.0.0') {
        candidateVersion = 1;
    } else if (obj['version'] === undefined && obj['schemaVersion'] === undefined) {
        // Versionless fixtures — treat as v1.
        candidateVersion = 1;
    } else if (typeof obj['version'] === 'string') {
        // Legacy semver string we don't recognize.
        throw new EdgeListLoadError(
            filePath,
            'unknown-version',
            String(obj['version']),
        );
    } else {
        throw new EdgeListLoadError(
            filePath,
            'unknown-version',
            String(obj['schemaVersion']),
        );
    }

    if (candidateVersion !== 1) {
        throw new EdgeListLoadError(
            filePath,
            'unknown-version',
            String(candidateVersion),
        );
    }

    // Build the candidate v1 doc: drop legacy `version`, force `schemaVersion: 1`.
    const candidate: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
        if (key === 'version' || key === 'schemaVersion') continue;
        candidate[key] = value;
    }
    candidate.schemaVersion = 1;

    const result = EdgeListV1Schema.safeParse(candidate);
    if (!result.success) {
        const detail = result.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ');
        throw new EdgeListLoadError(filePath, 'schema-error', detail);
    }
    return result.data;
}

/**
 * Validate-and-upgrade in one call. The single entry point callers should
 * use; future migrations chain inside without changing the callers' shape.
 */
export function loadEdgeListData(raw: unknown, filePath: string): EdgeListData {
    return migrate(raw, filePath);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describeType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}
