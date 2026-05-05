/**
 * FolderTreeStore — disk-I/O persistence for `FolderTreeData`.
 *
 * Loop 09 thin store class. Mirrors the `BaseEdgeListStore` pattern in
 * `src/graph/edgelist.ts` (post-Loop-23 `WorkspaceIO` migration), but is
 * **load/save value-typed**: there is no in-memory mutable state, no
 * dirty-flag dance. The regenerator builds a fresh `FolderTreeData` per
 * scan and hands it to `save`.
 *
 * Containment is enforced by `WorkspaceIO`; the legacy direct-fs branch
 * was removed in loop 07 — `WorkspaceIO` is now a *required* constructor
 * argument.
 */

import * as path from 'path';

import { WorkspaceIO } from '../workspace/workspace-io';
import {
    FolderTreeData,
    FolderTreeLoadError,
    migrateFolderTree,
    FOLDER_TREE_SCHEMA_VERSION,
} from './folder-tree';

export const FOLDER_TREE_FILENAME = 'folder-tree.json';

export class FolderTreeStore {
    private readonly filePath: string;
    private readonly io: WorkspaceIO;
    /** Workspace-relative form of `filePath`. */
    private readonly relPath: string;

    constructor(artifactDir: string, io: WorkspaceIO) {
        this.filePath = path.join(artifactDir, FOLDER_TREE_FILENAME);
        this.io = io;
        this.relPath = path.relative(this.io.getRealRoot(), this.filePath);
    }

    /**
     * Read `{artifactDir}/folder-tree.json`, parse + migrate via Zod.
     *
     * Throws `FolderTreeLoadError` on any failure:
     *   - missing file → reason `'parse-error'` (no sensible empty
     *     `FolderTreeData` to invent — the schema requires a non-null
     *     `root`; loop 12's HTTP route catches this and returns 404).
     *   - JSON.parse failure → reason `'parse-error'`.
     *   - schema mismatch → reason `'schema-error'` (via `migrateFolderTree`).
     *   - unknown `schemaVersion` → reason `'unknown-version'`.
     */
    async load(): Promise<FolderTreeData> {
        if (!(await this.io.exists(this.relPath))) {
            throw new FolderTreeLoadError(
                this.filePath,
                'parse-error',
                'file not found',
            );
        }
        let raw: unknown;
        try {
            const content = await this.io.readFile(this.relPath, 'utf-8');
            raw = JSON.parse(content);
        } catch (e) {
            throw new FolderTreeLoadError(
                this.filePath,
                'parse-error',
                `JSON.parse failed: ${(e as Error).message}`,
                e,
            );
        }
        return migrateFolderTree(raw, this.filePath);
    }

    /**
     * Write the envelope to disk, creating parent directories as needed.
     *
     * Always re-stamps `schemaVersion` (to the current constant) and
     * `timestamp` (to `new Date().toISOString()`). Round-trip equality
     * tests must compare `data.root` and `data.schemaVersion`, NOT
     * `data.timestamp`.
     *
     * Containment is enforced by `WorkspaceIO`; this method does not
     * call `assertContained` directly. `WorkspaceIO.writeFile` /
     * `mkdirRecursive` throw `PathEscapeError` (`code: PATH_ESCAPE`)
     * for paths that escape the workspace root.
     */
    async save(data: FolderTreeData): Promise<void> {
        const stamped: FolderTreeData = {
            ...data,
            schemaVersion: FOLDER_TREE_SCHEMA_VERSION,
            timestamp: new Date().toISOString(),
        };
        const content = JSON.stringify(stamped, null, 2);

        await this.io.mkdirRecursive(path.dirname(this.relPath));
        await this.io.writeFile(this.relPath, content);
    }
}
