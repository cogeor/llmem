/**
 * FolderEdgelistStore — disk-I/O persistence for `FolderEdgelistData`.
 *
 * Loop 09 thin store class. Same shape and semantics as `FolderTreeStore`
 * (see that file for the WorkspaceIO/back-compat rationale).
 *
 * Intentional duplication with folder-tree-store.ts; see PLAN.md task 2
 * step 4 for the rationale (two trivial methods, two different payload
 * shapes — generic base would not save real boilerplate yet).
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

import { WorkspaceIO } from '../workspace/workspace-io';
import {
    FolderEdgelistData,
    FolderEdgelistLoadError,
    migrateFolderEdges,
    FOLDER_EDGES_SCHEMA_VERSION,
} from './folder-edges';

export const FOLDER_EDGELIST_FILENAME = 'folder-edgelist.json';

export class FolderEdgelistStore {
    private readonly filePath: string;
    private readonly io: WorkspaceIO | null;
    /** Workspace-relative form of `filePath`. Only meaningful when `io` is set. */
    private readonly relPath: string;

    constructor(artifactDir: string, io?: WorkspaceIO) {
        this.filePath = path.join(artifactDir, FOLDER_EDGELIST_FILENAME);
        this.io = io ?? null;
        this.relPath = this.io
            ? path.relative(this.io.getRealRoot(), this.filePath)
            : '';
    }

    /**
     * Read `{artifactDir}/folder-edgelist.json`, parse + migrate via Zod.
     *
     * Throws `FolderEdgelistLoadError` on any failure:
     *   - missing file → reason `'parse-error'`.
     *   - JSON.parse failure → reason `'parse-error'`.
     *   - schema mismatch → reason `'schema-error'` (via `migrateFolderEdges`).
     *   - unknown `schemaVersion` → reason `'unknown-version'`.
     */
    async load(): Promise<FolderEdgelistData> {
        if (this.io) {
            if (!(await this.io.exists(this.relPath))) {
                throw new FolderEdgelistLoadError(
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
                throw new FolderEdgelistLoadError(
                    this.filePath,
                    'parse-error',
                    `JSON.parse failed: ${(e as Error).message}`,
                    e,
                );
            }
            return migrateFolderEdges(raw, this.filePath);
        }

        if (!fsSync.existsSync(this.filePath)) {
            throw new FolderEdgelistLoadError(
                this.filePath,
                'parse-error',
                'file not found',
            );
        }
        let raw: unknown;
        try {
            const content = await fs.readFile(this.filePath, 'utf-8');
            raw = JSON.parse(content);
        } catch (e) {
            throw new FolderEdgelistLoadError(
                this.filePath,
                'parse-error',
                `JSON.parse failed: ${(e as Error).message}`,
                e,
            );
        }
        return migrateFolderEdges(raw, this.filePath);
    }

    /**
     * Write the envelope to disk, creating parent directories as needed.
     *
     * Always re-stamps `schemaVersion` (to the current constant) and
     * `timestamp`. `edges` and `weightP90` are preserved as-is. Round-trip
     * equality tests must compare those fields, NOT `data.timestamp`.
     *
     * Containment is enforced by `WorkspaceIO` — see folder-tree-store.ts
     * for the rationale.
     */
    async save(data: FolderEdgelistData): Promise<void> {
        const stamped: FolderEdgelistData = {
            ...data,
            schemaVersion: FOLDER_EDGES_SCHEMA_VERSION,
            timestamp: new Date().toISOString(),
        };
        const content = JSON.stringify(stamped, null, 2);

        if (this.io) {
            await this.io.mkdirRecursive(path.dirname(this.relPath));
            await this.io.writeFile(this.relPath, content);
            return;
        }

        const dir = path.dirname(this.filePath);
        if (!fsSync.existsSync(dir)) {
            await fs.mkdir(dir, { recursive: true });
        }
        await fs.writeFile(this.filePath, content, 'utf-8');
    }
}
