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
