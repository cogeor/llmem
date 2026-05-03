/**
 * WorkspaceIO — realpath-based containment FS surface.
 *
 * Loop 23 introduces this class as the single I/O surface for callers that
 * need realpath-strong containment guarantees. Every public method:
 *
 *   1. validates the input as a relative path (or coerces an absolute
 *      path that already lives under the realpath of the root),
 *   2. resolves it against the realpath of the root,
 *   3. realpath-resolves the resulting absolute path (or its nearest
 *      existing parent for new files / unlink targets),
 *   4. asserts the realpath is contained under `realRoot`,
 *   5. performs the I/O.
 *
 * Throws `PathEscapeError` (`code: PATH_ESCAPE`) when (4) fails. Throws
 * `WorkspaceNotFoundError` when the constructor cannot stat or realpath
 * the root.
 *
 * The function-style `safeReadFile` / `safeWriteFile` / `safeMkdir` in
 * `safe-fs.ts` remain available for callers that haven't migrated. They
 * keep their textual-only semantics (the L22 contract). `WorkspaceIO` is
 * additive.
 *
 * Async-only by design. The realpath of the root is computed once via
 * the async `create` factory; child realpaths are computed per-call so
 * symlinks rotating under the workspace are handled correctly.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { Stats } from 'fs';
import {
    type WorkspaceRoot,
    type AbsPath,
    asAbsPath,
    toAbs,
    assertContained,
} from '../core/paths';
import { WorkspaceNotFoundError } from '../core/errors';

export class WorkspaceIO {
    private readonly realRoot: AbsPath;

    /**
     * Use `WorkspaceIO.create(root)` (or `createWorkspaceIO(root)`). The
     * async factory does the realpath that the synchronous constructor
     * cannot.
     */
    private constructor(realRoot: AbsPath) {
        this.realRoot = realRoot;
    }

    /**
     * Construct a `WorkspaceIO` for `root`. Resolves and realpath-canonicalizes
     * the root; throws `WorkspaceNotFoundError` if the root does not exist
     * or is not statable.
     */
    static async create(root: WorkspaceRoot): Promise<WorkspaceIO> {
        let real: string;
        try {
            real = await fs.realpath(path.resolve(root));
        } catch {
            // ENOENT, ENOTDIR, EACCES → workspace root missing or unreadable.
            throw new WorkspaceNotFoundError(root);
        }
        return new WorkspaceIO(asAbsPath(real));
    }

    // ------------------------------------------------------------------
    // Path resolution helpers
    // ------------------------------------------------------------------

    /**
     * Pure path resolution — no FS call. Resolves `rel` against the realpath
     * of the workspace root and asserts textual containment. Useful for
     * callers that already validated containment and want the canonical
     * absolute form.
     */
    resolve(rel: string): AbsPath {
        const abs = toAbs(rel, this.realRoot);
        assertContained(abs, this.realRoot);
        return abs;
    }

    /**
     * Public realpath helper. Resolves `rel`, then realpath-canonicalizes
     * the result; asserts the realpath is contained under `realRoot`.
     * Throws `PathEscapeError` if either step escapes.
     */
    async realpath(rel: string): Promise<AbsPath> {
        const abs = this.resolve(rel);
        const real = await fs.realpath(abs);
        assertContained(asAbsPath(real), this.realRoot);
        return asAbsPath(real);
    }

    /** Read-only access to the realpath form of the workspace root. */
    getRealRoot(): AbsPath {
        return this.realRoot;
    }

    // ------------------------------------------------------------------
    // Existence / stat
    // ------------------------------------------------------------------

    /**
     * Returns `true` if `rel` exists and its realpath is contained under
     * the workspace root. Returns `false` for missing files. Throws
     * `PathEscapeError` if `rel` escapes textual containment OR if the
     * realpath of an existing target lives outside `realRoot` (escape
     * paths must not silently return false — that would mask bugs).
     */
    async exists(rel: string): Promise<boolean> {
        // Cheap textual containment first; throws PathEscapeError on
        // textual escape. We want escape paths to surface, not silently
        // report `false`.
        const abs = this.resolve(rel);
        try {
            const real = await fs.realpath(abs);
            assertContained(asAbsPath(real), this.realRoot);
            return true;
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'ENOENT' || code === 'ENOTDIR') return false;
            throw err;
        }
    }

    async stat(rel: string): Promise<Stats> {
        const real = await this.realpath(rel);
        return fs.stat(real);
    }

    /**
     * `lstat` does NOT follow the final symlink, on purpose. We use the
     * textual abs path (after `resolve`-time containment) and let the
     * caller interpret a symlink target. Symlinks pointing outside the
     * workspace are still detected at `readFile` / `realpath` time.
     */
    async lstat(rel: string): Promise<Stats> {
        const abs = this.resolve(rel);
        return fs.lstat(abs);
    }

    // ------------------------------------------------------------------
    // Read
    // ------------------------------------------------------------------

    async readFile(rel: string): Promise<string>;
    async readFile(rel: string, encoding: BufferEncoding): Promise<string>;
    async readFile(rel: string, encoding: null): Promise<Buffer>;
    async readFile(
        rel: string,
        encoding: BufferEncoding | null = 'utf-8',
    ): Promise<string | Buffer> {
        const real = await this.realpath(rel);
        if (encoding === null) return fs.readFile(real);
        return fs.readFile(real, { encoding });
    }

    async readDir(rel: string): Promise<string[]> {
        const real = await this.realpath(rel);
        return fs.readdir(real);
    }

    // ------------------------------------------------------------------
    // Write / mutate
    // ------------------------------------------------------------------

    /**
     * Write `data` to `rel`, creating no parent directories (use
     * `mkdirRecursive` first if needed). The target file may not exist
     * yet, so `realpath` would ENOENT — instead we walk up to the
     * nearest existing ancestor and assert ITS realpath is contained.
     */
    async writeFile(rel: string, data: string | Buffer): Promise<void> {
        const abs = this.resolve(rel);
        await this.assertParentContained(abs);
        if (typeof data === 'string') {
            await fs.writeFile(abs, data, { encoding: 'utf-8' });
        } else {
            await fs.writeFile(abs, data);
        }
    }

    async mkdirRecursive(rel: string): Promise<void> {
        const abs = this.resolve(rel);
        await this.assertParentContained(abs);
        await fs.mkdir(abs, { recursive: true });
    }

    /**
     * Remove a file at `rel`. The file itself might be a symlink we want
     * to remove, so we deliberately do NOT realpath it (that would
     * dereference and reject). Instead we validate the parent dir's
     * realpath is contained under `realRoot`.
     */
    async unlink(rel: string): Promise<void> {
        const abs = this.resolve(rel);
        await this.assertParentContained(abs);
        await fs.unlink(abs);
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    /**
     * Walk up from the parent of `abs` until an existing ancestor is
     * found, realpath it, and assert it lives under `realRoot`. Used by
     * write/mkdir/unlink where the target itself may not exist.
     *
     * Falls back to a textual containment check if the walk reaches the
     * filesystem root without finding any existing ancestor (extremely
     * unlikely in practice — `realRoot` exists by construction, so the
     * walk will terminate at it at the latest).
     */
    private async assertParentContained(abs: AbsPath): Promise<void> {
        // Cheap textual containment first (catches most attacks).
        assertContained(abs, this.realRoot);
        // If `abs` IS the workspace root (e.g. caller passed `.` to
        // `mkdirRecursive`), the realpath of the root has already been
        // validated by the factory; no further check needed.
        if (path.resolve(abs) === this.realRoot) return;
        let probe = path.dirname(abs);
        for (;;) {
            try {
                const real = await fs.realpath(probe);
                assertContained(asAbsPath(real), this.realRoot);
                return;
            } catch (err) {
                const code = (err as NodeJS.ErrnoException).code;
                if (code !== 'ENOENT' && code !== 'ENOTDIR') throw err;
                const parent = path.dirname(probe);
                if (parent === probe) {
                    // Hit filesystem root with nothing existing in between.
                    // Use realRoot as the anchor (textual check already passed).
                    assertContained(abs, this.realRoot);
                    return;
                }
                probe = parent;
            }
        }
    }
}

/** Convenience factory mirroring L22's `asWorkspaceRoot` ergonomics. */
export async function createWorkspaceIO(
    root: WorkspaceRoot,
): Promise<WorkspaceIO> {
    return WorkspaceIO.create(root);
}
