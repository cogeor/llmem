/**
 * Safe filesystem helpers. Path-containment + thin fs.promises wrappers
 * that throw PathEscapeError when a candidate path resolves outside the
 * workspace root.
 *
 * NOTE: this module declares the contract. Loop 04 migrates only the
 * documentation writers (info/folder.ts, info/mcp.ts). Other writers
 * (graph/edgelist, scripts, plot/generator, webview generators) migrate
 * in their own Phase-3 / Phase-4 loops. See tests/arch/workspace-paths.ts
 * WRITE_ALLOWLIST for the live list of writers not yet migrated.
 *
 * Containment: textual only (path.resolve + path.relative). Symlink-based
 * escape requires fs.realpathSync; tests/arch/workspace-paths.test.ts
 * pins this expectation so a future loop can layer realpath on top
 * without breaking the contract.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { WorkspaceRoot, AbsPath, RelPath } from '../core/paths';
import { asAbsPath } from '../core/paths';
import { PathEscapeError } from '../core/errors';

export type { WorkspaceRoot, AbsPath, RelPath } from '../core/paths';
export { asWorkspaceRoot, asAbsPath, asRelPath, toAbs, toRel, assertContained } from '../core/paths';
export { PathEscapeError } from '../core/errors';

/**
 * Resolve `candidate` against `root`, throwing PathEscapeError if the
 * resolved path is outside `root`. Equivalent semantics to the Loop 01
 * stub helper, plus a typed error.
 */
export function resolveInsideWorkspace(root: WorkspaceRoot, candidate: string): AbsPath {
    const rootResolved = path.resolve(root);
    const resolved = path.resolve(rootResolved, candidate);
    const rel = path.relative(rootResolved, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new PathEscapeError(rootResolved, candidate);
    }
    return asAbsPath(resolved);
}

/**
 * Write a file inside the workspace, creating parent directories as needed.
 * Throws PathEscapeError if `relPath` resolves outside `root`.
 */
export async function safeWriteFile(
    root: WorkspaceRoot,
    relPath: RelPath,
    contents: string,
): Promise<void> {
    const target = resolveInsideWorkspace(root, relPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, { encoding: 'utf-8' });
}

/**
 * Read a file inside the workspace. Returns null when the file is missing.
 * Throws PathEscapeError if `relPath` resolves outside `root`.
 */
export async function safeReadFile(
    root: WorkspaceRoot,
    relPath: RelPath,
): Promise<string | null> {
    const target = resolveInsideWorkspace(root, relPath);
    try {
        return await fs.readFile(target, { encoding: 'utf-8' });
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
    }
}

/**
 * Create a directory inside the workspace, recursively. Throws
 * PathEscapeError if `relPath` resolves outside `root`.
 */
export async function safeMkdir(
    root: WorkspaceRoot,
    relPath: RelPath,
): Promise<void> {
    const target = resolveInsideWorkspace(root, relPath);
    await fs.mkdir(target, { recursive: true });
}

// L23: realpath-strong containment surface. Re-exported from this module
// so callers that already import from `workspace/safe-fs` reach the new
// class via a single import path.
export { WorkspaceIO, createWorkspaceIO } from './workspace-io';
