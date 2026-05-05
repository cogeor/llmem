/**
 * Edge-list schema (Loop 16; bumped to v2 by Loop 13 of the
 * codebase-quality-v2 cycle).
 *
 * Owns the single source of truth for the persisted edge-list shape. The
 * Zod schemas double as TypeScript types via `z.infer`, replacing the
 * hand-typed interfaces that previously lived in `edgelist.ts`.
 *
 * Versioning
 * ----------
 * The persisted envelope carries TWO version fields:
 *   - `schemaVersion: 2` — monotonic integer for the on-disk shape.
 *   - `resolverVersion: 'ts-resolveModuleName-v1'` — names the import
 *     resolver implementation that produced the file. Loop 12 swapped
 *     the heuristic resolver for `ts.resolveModuleName`, which changes
 *     the `resolvedPath` semantics for path-alias / baseUrl /
 *     index-file / re-export specifiers. Mixing pre-Loop-12 entries
 *     with new ones produces a split-brain graph; the resolver stamp
 *     lets the migrator detect the mismatch and force a rescan.
 *
 * Acceptance rule
 * ---------------
 * The migrator accepts ONLY documents whose
 * `(schemaVersion, resolverVersion)` pair exactly matches the current
 * code (`EDGELIST_SCHEMA_VERSION` / `EDGELIST_RESOLVER_VERSION`). Any
 * other combination — including the legacy `schemaVersion: 1`,
 * `version: '1.0.0'`, and versionless test fixtures that the previous
 * release tolerated — throws `SchemaMismatchError` (a typed subclass
 * of `EdgeListLoadError` whose `reason` is `'unknown-version'`). Each
 * loader callsite catches that error and triggers a fresh scan
 * (`scanFolderRecursive`) instead of mixing shapes.
 *
 * No silent reset: the previous `BaseEdgeListStore.load` swallowed schema
 * failures and reset the store to empty, which produced silent data loss
 * on the next save. The new behavior is to throw and let the caller decide.
 */

import { z } from 'zod';

export const EDGELIST_SCHEMA_VERSION = 2;
export const EDGELIST_RESOLVER_VERSION = 'ts-resolveModuleName-v1';

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

export const EdgeListV2Schema = z.object({
    schemaVersion: z.literal(EDGELIST_SCHEMA_VERSION),
    resolverVersion: z.literal(EDGELIST_RESOLVER_VERSION),
    timestamp: z.string(),
    nodes: z.array(NodeEntrySchema),
    edges: z.array(EdgeEntrySchema),
});

// ---------------------------------------------------------------------------
// Inferred types (single source of truth — re-exported from `edgelist.ts`)
// ---------------------------------------------------------------------------

export type NodeEntry = z.infer<typeof NodeEntrySchema>;
export type EdgeEntry = z.infer<typeof EdgeEntrySchema>;
export type EdgeListData = z.infer<typeof EdgeListV2Schema>;

// ---------------------------------------------------------------------------
// Error types
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

/**
 * Subclass of `EdgeListLoadError` raised when the on-disk envelope's
 * `(schemaVersion, resolverVersion)` pair does not match the values
 * encoded in this build. Callers are expected to catch this specific
 * subclass and respond by clearing the store and triggering a fresh
 * `scanFolderRecursive` (or the host-appropriate equivalent).
 *
 * `reason` is reused as `'unknown-version'` so existing
 * `reason`-discriminated tests / log filters keep working; the
 * subclass identity is the discriminator new code uses.
 */
export class SchemaMismatchError extends EdgeListLoadError {
    constructor(
        filePath: string,
        public readonly oldSchemaVersion: number | null,
        public readonly oldResolverVersion: string | null,
    ) {
        const detail =
            `expected schemaVersion=${EDGELIST_SCHEMA_VERSION} ` +
            `resolverVersion='${EDGELIST_RESOLVER_VERSION}'; ` +
            `found schemaVersion=${oldSchemaVersion ?? '<missing>'} ` +
            `resolverVersion='${oldResolverVersion ?? '<missing>'}'`;
        super(filePath, 'unknown-version', detail);
        this.name = 'SchemaMismatchError';
    }
}

// ---------------------------------------------------------------------------
// Empty-state factory
// ---------------------------------------------------------------------------

export function createEmptyEdgeList(): EdgeListData {
    return {
        schemaVersion: EDGELIST_SCHEMA_VERSION,
        resolverVersion: EDGELIST_RESOLVER_VERSION,
        timestamp: new Date().toISOString(),
        nodes: [],
        edges: [],
    };
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Strict version-pair gate. Throws `SchemaMismatchError` on any
 * envelope whose `(schemaVersion, resolverVersion)` does not exactly
 * match the current build. Throws plain `EdgeListLoadError` (with
 * `reason: 'schema-error'`) on documents that match the version pair
 * but have a malformed `nodes` / `edges` array.
 *
 * Pre-Loop-13 acceptance paths (`version: '1.0.0'`, versionless,
 * `schemaVersion: 1`) all flow through the mismatch branch — those
 * shapes carry pre-resolver-swap `resolvedPath` semantics and must
 * not be merged with the new resolver's output.
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

    // Extract whatever the on-disk envelope claims, normalizing the
    // missing/wrong-type cases into typed nulls for the diagnostic.
    const oldSchemaVersion =
        typeof obj['schemaVersion'] === 'number'
            ? (obj['schemaVersion'] as number)
            : null;
    const oldResolverVersion =
        typeof obj['resolverVersion'] === 'string'
            ? (obj['resolverVersion'] as string)
            : null;

    // Strict identity check: anything other than the exact current pair
    // throws SchemaMismatchError. Callers catch this, clear, and rescan.
    if (
        oldSchemaVersion !== EDGELIST_SCHEMA_VERSION ||
        oldResolverVersion !== EDGELIST_RESOLVER_VERSION
    ) {
        throw new SchemaMismatchError(
            filePath,
            oldSchemaVersion,
            oldResolverVersion,
        );
    }

    // Version pair matches; validate the rest of the shape strictly.
    const result = EdgeListV2Schema.safeParse(obj);
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
