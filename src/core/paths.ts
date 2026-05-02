/**
 * Branded path types. Zero-runtime: every brand widens cleanly to `string`.
 *
 * Use `as*` casts at the boundary where a plain string enters a typed
 * helper (e.g. workspace/safe-fs, docs/arch-store). Existing callers that
 * pass plain strings are not retrofitted in this loop; that's a Phase-3
 * concern.
 */

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
