/**
 * Folder-tree DTO + Zod schema + load-error contract (Loop 17).
 *
 * Browser-safe surface extracted from `src/graph/folder-tree.ts`. Loop 13
 * had to type-only import these symbols from the graph module because the
 * graph module also imports `path` (Node-only) for its `folderOf` helper.
 * This contracts module owns the schema/types/error class with NO Node
 * imports, so browser code can `import` (not `import type`) from here
 * once it needs runtime symbols (currently the static provider keeps a
 * manual schemaVersion gate; future work may upgrade to
 * `FolderTreeSchema.parse`). The `src/graph/folder-tree.ts` module
 * re-exports every symbol below for one-loop compat with existing Node
 * callers.
 *
 * Folder-path conventions
 * -----------------------
 * - The root folder is `path: ""`, `name: ""`.
 * - Top-level files (no `/` in `fileId`) live in a folder whose path is
 *   `"."` — attached as a child of the root with `name: "."`. This keeps
 *   the recursion uniform; the UI can collapse it.
 */

import { z } from 'zod';

export const FOLDER_TREE_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FolderNode {
    /** Forward-slash folder path. `""` for root, `"."` for top-level files. */
    path: string;
    /** Basename of `path` (`""` for root, `"."` for the top-level bucket). */
    name: string;
    /** Recursive count of files in this folder and all descendants. */
    fileCount: number;
    /** Recursive sum of `loc` for files in this folder and all descendants. */
    totalLOC: number;
    /** Whether `.arch/{path}/README.md` exists (passed in via `documentedFolders`). */
    documented: boolean;
    /** Sorted alphabetically by `name` for deterministic output. */
    children: FolderNode[];
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

// Recursive Zod schema — `z.lazy` is required for self-references.
export const FolderNodeSchema: z.ZodType<FolderNode> = z.lazy(() =>
    z.object({
        path: z.string(),
        name: z.string(),
        fileCount: z.number().int().nonnegative(),
        totalLOC: z.number().int().nonnegative(),
        documented: z.boolean(),
        children: z.array(FolderNodeSchema),
    }),
);

export const FolderTreeSchema = z.object({
    schemaVersion: z.literal(FOLDER_TREE_SCHEMA_VERSION),
    timestamp: z.string(),
    root: FolderNodeSchema,
});

export type FolderTreeData = z.infer<typeof FolderTreeSchema>;

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export type FolderTreeLoadErrorReason =
    | 'parse-error'
    | 'schema-error'
    | 'unknown-version';

export class FolderTreeLoadError extends Error {
    constructor(
        public readonly filePath: string,
        public readonly reason: FolderTreeLoadErrorReason,
        public readonly detail: string,
        cause?: unknown,
    ) {
        super(`[folder-tree] ${reason} loading ${filePath}: ${detail}`);
        this.name = 'FolderTreeLoadError';
        if (cause !== undefined) {
            (this as { cause?: unknown }).cause = cause;
        }
    }
}
