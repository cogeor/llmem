/**
 * .arch path mapping. Single owner of the documentation-tree paths
 * across LLMem.
 *
 * Today's call sites (before Loop 04):
 * - src/webview/design-docs.ts:29       — archRoot construction
 * - src/webview/design-docs.ts:81-86    — design-doc key mapping (.md -> .html, README preserved)
 * - src/info/folder.ts:42, :224         — getFolderArchPath inlined
 * - src/info/mcp.ts:173                 — getFileArchPath inlined
 * - src/extension/hot-reload.ts:39      — archRoot construction (NOT migrated this loop)
 * - src/claude/server/arch-watcher.ts:52 — archRoot construction (NOT migrated this loop)
 *
 * Loop 04 migrates info/folder.ts, info/mcp.ts, and webview/design-docs.ts
 * (the design-doc key mapper). The two host-watcher uses (hot-reload,
 * arch-watcher) migrate in Loops 06 / 11 when those services move.
 *
 * Behavior pinned by tests/arch/design-doc-keys.test.ts. Any change to
 * getDesignDocKey must update the behavioral table in the same commit.
 */

import * as path from 'path';
import type { WorkspaceRoot, AbsPath, RelPath } from '../core/paths';
import { asAbsPath, asRelPath } from '../core/paths';
import type { WorkspaceIO } from '../workspace/workspace-io';

export const ARCH_DIR = '.arch';

export function getArchRoot(root: WorkspaceRoot): AbsPath {
    return asAbsPath(path.join(root, ARCH_DIR));
}

export function getFileArchPath(root: WorkspaceRoot, src: RelPath): AbsPath {
    return asAbsPath(path.join(root, ARCH_DIR, `${src}.md`));
}

export function getFolderArchPath(root: WorkspaceRoot, src: RelPath): AbsPath {
    return asAbsPath(path.join(root, ARCH_DIR, src, 'README.md'));
}

/**
 * Map an absolute .arch path to its design-doc key.
 *
 * Rules (pinned by tests/arch/design-doc-keys.test.ts):
 * - .arch/src/parser.md           -> src/parser.html         (.md -> .html)
 * - .arch/src/graph/README.md     -> src/graph/README.md     (README preserved, case-insensitive)
 * - .arch/README.md               -> README.md
 * - .arch/Readme.md               -> Readme.md               (case preserved in stem; basename match is case-insensitive)
 * - .arch/docs/README.MD          -> docs/README.MD
 *
 * Backslash paths (Windows) are normalized to forward slashes in the result.
 */
export function getDesignDocKey(archRoot: AbsPath, archPath: AbsPath): string {
    const relPath = path.relative(archRoot, archPath).replace(/\\/g, '/');
    const isReadme = path.basename(archPath).toLowerCase() === 'readme.md';
    return isReadme ? relPath : relPath.replace(/\.md$/, '.html');
}

/**
 * Reverse of the .arch tree mapping: given an absolute path inside
 * `archRoot`, return the source-relative path (no `.arch/` prefix, no
 * `.md` suffix manipulation — that's getDesignDocKey's job).
 *
 * Used by future watchers / walkers; not yet consumed inside this module.
 */
export function archToSourcePath(archRoot: AbsPath, archPath: AbsPath): RelPath {
    return asRelPath(path.relative(archRoot, archPath).replace(/\\/g, '/'));
}

/**
 * Walk `.arch/` and return the set of folder paths (workspace-relative,
 * forward-slash) that contain a `README.md`. Used by the folder-tree
 * aggregator (Loop 10) to mark `documented: true` on `FolderNode` entries.
 *
 * Folder-path conventions match `buildFolderTree`:
 *   - `'.'` for the workspace root (`.arch/README.md` exists).
 *   - `'src/parser'` for `.arch/src/parser/README.md`.
 *
 * Backslashes never appear in the result because `WorkspaceIO.readDir`
 * returns plain entry names (no separators inside) and we concatenate
 * with literal `/`.
 *
 * Returns an empty set if `.arch/` does not exist. Uses `WorkspaceIO`
 * for realpath-strong containment; symlinks pointing outside the
 * workspace surface as `PathEscapeError`. This helper does not catch —
 * callers can decide whether to swallow or rethrow.
 *
 * Builds a fresh set per call. The regenerator runs this on every
 * regenerate event; callers that want caching can layer it on later.
 *
 * README casing: case-insensitive match (matches the existing
 * `getDesignDocKey` rule above).
 */
export async function scanArchFolders(io: WorkspaceIO): Promise<Set<string>> {
    const out = new Set<string>();
    if (!(await io.exists(ARCH_DIR))) return out;

    async function walk(relDir: string): Promise<void> {
        const entries = await io.readDir(relDir);
        let hasReadme = false;
        for (const entry of entries) {
            const childRel = relDir === ''
                ? entry
                : `${relDir}/${entry}`;
            const stat = await io.stat(childRel);
            if (stat.isDirectory()) {
                await walk(childRel);
            } else if (entry.toLowerCase() === 'readme.md') {
                hasReadme = true;
            }
        }
        if (hasReadme) {
            // Strip the leading `.arch/` segment; emit `'.'` for the
            // workspace root (where .arch/README.md lives).
            if (relDir === ARCH_DIR) {
                out.add('.');
            } else {
                // relDir is e.g. ".arch/src/parser" → "src/parser"
                out.add(relDir.slice(ARCH_DIR.length + 1));
            }
        }
    }

    await walk(ARCH_DIR);
    return out;
}
