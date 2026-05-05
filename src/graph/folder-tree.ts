/**
 * Folder-tree domain primitive (Loop 08; refactored Loop 17).
 *
 * Pure aggregator that turns the flat list of file IDs from the import
 * edge-list (plus a set of folders that have docs) into a recursive
 * `FolderTree`. No I/O — accepts plain data and returns plain data.
 *
 * Loop 17 split the type-only / Zod-schema / error-class surface out into
 * `src/contracts/folder-tree.ts` so browser code can import the schema
 * without dragging Node-only `path` (used by `folderOf`) into the
 * webview bundle. This module re-exports the contract symbols verbatim
 * so existing Node callers (`folder-artifacts.ts`, route handlers,
 * unit/integration tests) keep working.
 *
 * Folder-path conventions
 * -----------------------
 * - The root folder is `path: ""`, `name: ""`.
 * - Top-level files (no `/` in `fileId`) live in a folder whose path is
 *   `"."` — attached as a child of the root with `name: "."`. This keeps
 *   the recursion uniform; the UI can collapse it.
 * - All folder paths use forward slashes by construction. `folderOf` is
 *   shared (in spirit) with `folder-edges.ts`: backslashes are normalized
 *   to forward slashes so Windows-style file IDs aggregate into the same
 *   folder as their POSIX counterparts.
 */

import * as path from 'path';
import { isExternalModuleId } from '../core/ids';
import {
    FOLDER_TREE_SCHEMA_VERSION,
    FolderTreeSchema,
    FolderTreeLoadError,
    type FolderTreeData,
} from '../contracts/folder-tree';

// ---------------------------------------------------------------------------
// Re-exports from src/contracts/folder-tree (Loop 17 contracts split).
// ---------------------------------------------------------------------------

export {
    FOLDER_TREE_SCHEMA_VERSION,
    FolderNodeSchema,
    FolderTreeSchema,
    FolderTreeLoadError,
} from '../contracts/folder-tree';
export type {
    FolderNode,
    FolderTreeData,
    FolderTreeLoadErrorReason,
} from '../contracts/folder-tree';

// ---------------------------------------------------------------------------
// Builder input
// ---------------------------------------------------------------------------

export interface BuildFolderTreeInput {
    /** File-level nodes from the import edge list. */
    importNodes: { id: string; loc?: number }[];
    /**
     * Forward-slash folder paths that have `.arch/{folder}/README.md`.
     * Callers normalize before passing — the lookup is literal.
     */
    documentedFolders: Set<string>;
}

// ---------------------------------------------------------------------------
// Folder-path helper
// ---------------------------------------------------------------------------

/**
 * Compute the folder of a file ID.
 *
 * The rule is shared with `folder-edges.ts`:
 *   - Backslashes are normalized to forward slashes (Windows safety).
 *   - Top-level files (no `/`) map to `"."`.
 *   - Otherwise return the POSIX dirname.
 */
function folderOf(fileId: string): string {
    const normalized = fileId.replaceAll('\\', '/');
    const dir = path.posix.dirname(normalized);
    // path.posix.dirname returns '.' for "foo.ts" and the dir for "src/foo.ts".
    return dir === '.' ? '.' : dir;
}

/**
 * Decide whether a normalized ID names a workspace file.
 *
 * `isExternalModuleId` from `core/ids.ts` is the production gate but it
 * treats anything without a `/` as external — which trips a top-level
 * workspace file like `foo.ts`. We keep the prod check as the primary
 * gate and add a permissive fallback: if the basename has a file
 * extension, treat it as a workspace file. Bare module names (`react`,
 * `pathlib`) still fall through to "external".
 */
function isWorkspaceFileId(normalizedId: string): boolean {
    if (!isExternalModuleId(normalizedId)) return true;
    // No slash and no entity separator: fall back to "looks like a
    // filename" — has an extension dot somewhere after position 0 of
    // the basename.
    const dotIdx = normalizedId.lastIndexOf('.');
    return dotIdx > 0;
}

// ---------------------------------------------------------------------------
// Tree builder
// ---------------------------------------------------------------------------

interface MutableFolderNode {
    path: string;
    name: string;
    ownFileCount: number;
    ownTotalLOC: number;
    documented: boolean;
    children: Map<string, MutableFolderNode>;
}

function makeMutable(folderPath: string, name: string): MutableFolderNode {
    return {
        path: folderPath,
        name,
        ownFileCount: 0,
        ownTotalLOC: 0,
        documented: false,
        children: new Map(),
    };
}

/**
 * Walk the slash-separated path and ensure each ancestor exists, returning
 * the leaf node. Children of root are keyed by their path component.
 */
function ensureFolderPath(
    root: MutableFolderNode,
    folderPath: string,
    documentedFolders: Set<string>,
): MutableFolderNode {
    if (folderPath === '') return root;

    // Top-level files get a single child named ".".
    if (folderPath === '.') {
        let dot = root.children.get('.');
        if (!dot) {
            dot = makeMutable('.', '.');
            dot.documented = documentedFolders.has('.');
            root.children.set('.', dot);
        }
        return dot;
    }

    const parts = folderPath.split('/');
    let current = root;
    let accum = '';
    for (const part of parts) {
        accum = accum === '' ? part : `${accum}/${part}`;
        let child = current.children.get(part);
        if (!child) {
            child = makeMutable(accum, part);
            child.documented = documentedFolders.has(accum);
            current.children.set(part, child);
        }
        current = child;
    }
    return current;
}

/**
 * Convert a mutable node to its frozen `FolderNode` shape, sorting children
 * alphabetically by `name` and aggregating counts bottom-up.
 */
function freeze(node: MutableFolderNode): import('../contracts/folder-tree').FolderNode {
    const childArray: import('../contracts/folder-tree').FolderNode[] = [];
    const sortedKeys = Array.from(node.children.keys()).sort();
    let childFileCount = 0;
    let childTotalLOC = 0;
    for (const key of sortedKeys) {
        const frozen = freeze(node.children.get(key)!);
        childArray.push(frozen);
        childFileCount += frozen.fileCount;
        childTotalLOC += frozen.totalLOC;
    }
    return {
        path: node.path,
        name: node.name,
        fileCount: node.ownFileCount + childFileCount,
        totalLOC: node.ownTotalLOC + childTotalLOC,
        documented: node.documented,
        children: childArray,
    };
}

export function buildFolderTree(input: BuildFolderTreeInput): FolderTreeData {
    const root = makeMutable('', '');
    root.documented = input.documentedFolders.has('');

    for (const node of input.importNodes) {
        const normalized = node.id.replaceAll('\\', '/');
        if (!isWorkspaceFileId(normalized)) continue;
        const folderPath = folderOf(node.id);
        const folderNode = ensureFolderPath(root, folderPath, input.documentedFolders);
        folderNode.ownFileCount += 1;
        folderNode.ownTotalLOC += node.loc ?? 0;
    }

    return {
        schemaVersion: FOLDER_TREE_SCHEMA_VERSION,
        timestamp: new Date().toISOString(),
        root: freeze(root),
    };
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Accept versionless and `schemaVersion: 1` documents; reject everything
 * else with `FolderTreeLoadError`. Mirrors `migrate` in
 * `edgelist-schema.ts`.
 */
export function migrateFolderTree(raw: unknown, filePath: string): FolderTreeData {
    if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new FolderTreeLoadError(
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
        // Versionless fixtures — treat as v1.
        candidateVersion = 1;
    } else {
        throw new FolderTreeLoadError(
            filePath,
            'unknown-version',
            String(obj['schemaVersion']),
        );
    }

    if (candidateVersion !== 1) {
        throw new FolderTreeLoadError(
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

    const result = FolderTreeSchema.safeParse(candidate);
    if (!result.success) {
        const detail = result.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ');
        throw new FolderTreeLoadError(filePath, 'schema-error', detail);
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
