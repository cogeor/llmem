import * as fs from 'fs/promises';
import * as path from 'path';

import { WorkspaceIO } from '../workspace/workspace-io';

/**
 * L23: realpath-strong artifact storage.
 *
 * `ArtifactStorage` is the new green-field surface — it routes every
 * read/write/delete/exists through a `WorkspaceIO`, so symlink-target-
 * outside-workspace attacks are blocked at the boundary.
 *
 * The free-function exports below (`writeFile`, `readFile`, `deleteFile`,
 * `exists`) remain available for back-compat with `artifact/index.ts`
 * and the largely-`// DISABLED` paths in `artifact/service.ts`. Per
 * PLAN §23.2.c "Decisions": rather than building a synthetic
 * `WorkspaceRoot` per call (awkward, since callers pass arbitrary
 * absolute paths), we leave the free functions calling raw `fs` for
 * now. Live writers should prefer `ArtifactStorage`.
 */
export class ArtifactStorage {
    constructor(private readonly io: WorkspaceIO) {}

    /** Write `content` to `relPath`, creating parent dirs as needed. */
    async writeFile(relPath: string, content: string): Promise<void> {
        const dir = path.dirname(relPath);
        if (dir && dir !== '.') {
            await this.io.mkdirRecursive(dir);
        }
        await this.io.writeFile(relPath, content);
    }

    /** Read `relPath` as UTF-8. Returns `null` if missing. */
    async readFile(relPath: string): Promise<string | null> {
        if (!(await this.io.exists(relPath))) return null;
        return this.io.readFile(relPath, 'utf-8');
    }

    /** Remove `relPath`. Returns `true` if removed, `false` if missing. */
    async deleteFile(relPath: string): Promise<boolean> {
        if (!(await this.io.exists(relPath))) return false;
        await this.io.unlink(relPath);
        return true;
    }

    /** Returns `true` if `relPath` exists inside the workspace. */
    async exists(relPath: string): Promise<boolean> {
        return this.io.exists(relPath);
    }
}

// ---------------------------------------------------------------------------
// Legacy free-function exports (back-compat). Kept on raw `fs` per the
// PLAN §23.2.c fallback option: callers pass arbitrary absolute paths
// that aren't necessarily workspace-relative, so a synthetic-root wrap
// would add complexity for no real safety win in this loop. Live writers
// should use `ArtifactStorage` instead.
// ---------------------------------------------------------------------------

/**
 * Ensures the directory exists before writing.
 */
export async function writeFile(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, content, { encoding: 'utf-8' });
}

export async function readFile(filePath: string): Promise<string | null> {
    try {
        return await fs.readFile(filePath, { encoding: 'utf-8' });
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

export async function deleteFile(filePath: string): Promise<boolean> {
    try {
        await fs.unlink(filePath);
        // Attempt to clean up empty parent directories?
        // For now, let's keep it simple.
        return true;
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

export async function exists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}
