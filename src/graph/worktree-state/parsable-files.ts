/**
 * Watch Service — parsable-file helpers.
 *
 * Lifted out of `graph/worktree-state.ts` (B7 split). The class
 * re-exports these so importers are unchanged.
 *
 * Loop 08 deleted the last preserved free helper
 * (`unsafeLegacyListParsableFiles`); the only remaining listing helper is
 * `listParsableFilesIO`, which is realpath-strong.
 */

import * as path from 'path';
import { WorkspaceIO } from '../../workspace/workspace-io';

export const PARSABLE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.hpp'];

/**
 * Check if a file is parsable based on extension.
 */
export function isParsableFile(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return PARSABLE_EXTS.includes(ext);
}

/**
 * L23: realpath-strong variant of `listParsableFiles`. Walks the
 * workspace-relative `startRel` via `WorkspaceIO.readDir` + `lstat`,
 * returning absolute paths (anchored on `io.getRealRoot()`). Symlinks
 * are deliberately skipped via `lstat` to avoid double-counting and to
 * stop the walk at symlink boundaries; targets pointing outside the
 * workspace would be rejected by `readDir`'s realpath check anyway.
 */
export async function listParsableFilesIO(
    io: WorkspaceIO,
    startRel: string,
): Promise<string[]> {
    const files: string[] = [];
    const root = io.getRealRoot();

    async function walkDir(rel: string) {
        let entries: string[];
        try {
            entries = await io.readDir(rel);
        } catch {
            return;
        }
        for (const name of entries) {
            if (name.startsWith('.') || name === 'node_modules') continue;
            const childRel = rel === '' || rel === '.' ? name : path.join(rel, name);
            let st;
            try {
                st = await io.lstat(childRel);
            } catch {
                continue;
            }
            if (st.isSymbolicLink()) continue;
            if (st.isDirectory()) {
                await walkDir(childRel);
            } else if (st.isFile() && isParsableFile(name)) {
                files.push(path.join(root, childRel));
            }
        }
    }

    await walkDir(startRel);
    return files.sort();
}
