/**
 * Branded path types. Zero-runtime: every brand widens cleanly to `string`.
 *
 * Use `as*` casts at the boundary where a plain string enters a typed
 * helper (e.g. workspace/safe-fs, docs/arch-store). Existing callers that
 * pass plain strings are not retrofitted in this loop; that's a Phase-3
 * concern.
 *
 * L22 adds typed normalization helpers: `toAbs`, `toRel`,
 * `assertContained`. These are textual only — realpath containment is
 * L23's WorkspaceIO contract.
 */

import * as path from 'path';
import { PathEscapeError } from './errors';

export type WorkspaceRoot = string & { readonly __brand: 'WorkspaceRoot' };
export type AbsPath = string & { readonly __brand: 'AbsPath' };
export type RelPath = string & { readonly __brand: 'RelPath' };

export function asWorkspaceRoot(s: string): WorkspaceRoot {
    return s as WorkspaceRoot;
}

export function asAbsPath(s: string): AbsPath {
    return s as AbsPath;
}

export function asRelPath(s: string): RelPath {
    return s as RelPath;
}

/**
 * Resolve `input` against `base` and brand the result as AbsPath.
 *
 * - If `input` is already absolute, returns `path.resolve(input)` branded
 *   (normalizes separators and trailing slashes; on Windows also
 *   normalizes the drive letter case via `path.resolve`).
 * - If `input` is relative, returns `path.resolve(base, input)` branded.
 *
 * Does NOT check containment. Use `assertContained(result, base)` after
 * for that, or use `resolveInsideWorkspace` (workspace/safe-fs.ts).
 */
export function toAbs(
    input: string,
    base: WorkspaceRoot | AbsPath,
): AbsPath {
    const resolved = path.isAbsolute(input)
        ? path.resolve(input)
        : path.resolve(base, input);
    return resolved as AbsPath;
}

/**
 * Compute the path of `target` relative to `base` and brand the result
 * as RelPath.
 *
 * Throws PathEscapeError if the resulting relative path escapes `base`
 * (starts with `..` or is absolute, e.g. when `target` is on a different
 * Windows drive).
 */
export function toRel(
    target: AbsPath,
    base: WorkspaceRoot | AbsPath,
): RelPath {
    const baseResolved = path.resolve(base);
    const rel = path.relative(baseResolved, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new PathEscapeError(baseResolved, target);
    }
    return rel as RelPath;
}

/**
 * Assert that `child` is contained within `parent`. Textual containment
 * only (path.resolve + path.relative); does NOT follow symlinks. That
 * stronger contract is L23's WorkspaceIO concern.
 *
 * Throws PathEscapeError when `child` is outside `parent`. Returns void
 * on success.
 */
export function assertContained(
    child: AbsPath,
    parent: WorkspaceRoot | AbsPath,
): void {
    const parentResolved = path.resolve(parent);
    const childResolved = path.resolve(child);
    const rel = path.relative(parentResolved, childResolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new PathEscapeError(parentResolved, child);
    }
}
