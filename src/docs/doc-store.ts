/**
 * Documentation-tree path mapping. Single owner of the docs-tree paths
 * across LLMem. The docs tree now lives under `.llmem/docs` (was `.arch`).
 *
 * Call sites that derive the docs root from this owner:
 * - src/application/workspace-context.ts — getDocsRoot + DOCS_DIR (docsRoot / docsRootRel)
 * - src/extension/hot-reload.ts          — reads ctx.docsRoot (follows this owner automatically)
 * - src/http-server/arch-watcher.ts      — reads ctx.docsRoot / ctx.docsRootRel (follows automatically)
 *
 * Because hot-reload and arch-watcher consume the resolved `ctx.docsRoot`
 * / `ctx.docsRootRel` (computed once in workspace-context from DOCS_DIR),
 * they pick up the new prefix with no edit here.
 *
 * Behavior pinned by tests/arch/design-doc-keys.test.ts. Any change to
 * getDesignDocKey must update the behavioral table in the same commit.
 */

import * as path from 'path';
import type { WorkspaceRoot, AbsPath, RelPath } from '../core/paths';
import { asAbsPath, asRelPath } from '../core/paths';
import type { WorkspaceIO } from '../workspace/workspace-io';

export const DOCS_DIR = '.llmem/docs';

export function getDocsRoot(root: WorkspaceRoot): AbsPath {
    return asAbsPath(path.join(root, DOCS_DIR));
}

export function getFileDocPath(root: WorkspaceRoot, src: RelPath): AbsPath {
    return asAbsPath(path.join(root, DOCS_DIR, `${src}.md`));
}

export function getFolderDocPath(root: WorkspaceRoot, src: RelPath): AbsPath {
    return asAbsPath(path.join(root, DOCS_DIR, src, 'README.md'));
}

/**
 * Map an absolute docs-tree path to its design-doc key.
 *
 * Rules (pinned by tests/arch/design-doc-keys.test.ts):
 * - .llmem/docs/src/parser.md           -> src/parser.html         (.md -> .html)
 * - .llmem/docs/src/graph/README.md     -> src/graph/README.md     (README preserved, case-insensitive)
 * - .llmem/docs/README.md               -> README.md
 * - .llmem/docs/Readme.md               -> Readme.md               (case preserved in stem; basename match is case-insensitive)
 * - .llmem/docs/docs/README.MD          -> docs/README.MD
 *
 * Backslash paths (Windows) are normalized to forward slashes in the result.
 */
export function getDesignDocKey(docsRoot: AbsPath, docPath: AbsPath): string {
    const relPath = path.relative(docsRoot, docPath).replace(/\\/g, '/');
    const isReadme = path.basename(docPath).toLowerCase() === 'readme.md';
    return isReadme ? relPath : relPath.replace(/\.md$/, '.html');
}

/**
 * Reverse of the docs-tree mapping: given an absolute path inside
 * `docsRoot`, return the source-relative path (no `.llmem/docs/` prefix,
 * no `.md` suffix manipulation — that's getDesignDocKey's job).
 *
 * Used by future watchers / walkers; not yet consumed inside this module.
 */
export function docToSourcePath(docsRoot: AbsPath, docPath: AbsPath): RelPath {
    return asRelPath(path.relative(docsRoot, docPath).replace(/\\/g, '/'));
}

/**
 * Walk `.llmem/docs/` and return the set of folder paths (workspace-relative,
 * forward-slash) that contain a `README.md`. Used by the folder-tree
 * aggregator (Loop 10) to mark `documented: true` on `FolderNode` entries.
 *
 * Folder-path conventions match `buildFolderTree`:
 *   - `'.'` for the workspace root (`.llmem/docs/README.md` exists).
 *   - `'src/parser'` for `.llmem/docs/src/parser/README.md`.
 *
 * Backslashes never appear in the result because `WorkspaceIO.readDir`
 * returns plain entry names (no separators inside) and we concatenate
 * with literal `/`.
 *
 * Returns an empty set if `.llmem/docs/` does not exist. Uses `WorkspaceIO`
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
export async function scanDocFolders(io: WorkspaceIO): Promise<Set<string>> {
    const out = new Set<string>();
    if (!(await io.exists(DOCS_DIR))) return out;

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
            // Strip the leading `.llmem/docs/` prefix; emit `'.'` for the
            // workspace root (where .llmem/docs/README.md lives).
            if (relDir === DOCS_DIR) {
                out.add('.');
            } else {
                // relDir is e.g. ".llmem/docs/src/parser" → "src/parser".
                // `.length + 1` covers the whole prefix string (any number
                // of segments) plus the trailing separator.
                out.add(relDir.slice(DOCS_DIR.length + 1));
            }
        }
    }

    await walk(DOCS_DIR);
    return out;
}
