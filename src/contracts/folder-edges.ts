/**
 * Folder-edgelist DTO + Zod schema + load-error contract (Loop 17).
 *
 * Browser-safe surface extracted from `src/graph/folder-edges.ts`. The
 * graph module's `folderOf` helper imports `path` (Node-only); this
 * contracts module owns the schema/types/error class with NO Node
 * imports, so browser code can import without pulling node-only deps
 * into the bundle. `src/graph/folder-edges.ts` re-exports every symbol
 * below for one-loop compat with existing Node callers.
 */

import { z } from 'zod';

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
