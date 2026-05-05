/**
 * Shell-cache content-hash invalidation guard for `.artifacts/webview/`.
 *
 * Loop 01 closed the long-standing "delete `.artifacts/webview/` by hand"
 * developer step (CLAUDE.md). The static generator now hashes the shell
 * source + bundled assets, compares against the previous hash recorded in
 * `<destinationDir>/.shell-hash`, and rms the destination directory when
 * they diverge. A subsequent regeneration writes the fresh hash so the
 * next run is a no-op when nothing changed.
 *
 * Files hashed (in order):
 *   1. `src/webview/shell.ts`
 *   2. `src/webview/shell-assets.ts`
 *   3. Every file under `<extensionRoot>/dist/webview/` (when present).
 *      When `dist/webview/` is missing (dev-mode source render path,
 *      mirrors `useDistWebview` selection in `generator.ts`), we hash
 *      `src/webview/styles/`, `src/webview/libs/`, and `src/webview/ui/`
 *      instead.
 *
 * Files are sorted by repo-relative posix path before hashing so the
 * digest is stable across platforms.
 *
 * This module owns `.artifacts/webview/` cache writes — `fs.rmSync` for
 * invalidation and `fs.writeFileSync` for the hash file. It is on the
 * `WRITE_ALLOWLIST` in `tests/arch/workspace-paths.test.ts` Part B with
 * that justification.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

/** Filename for the cached hash inside `<destinationDir>`. */
const HASH_FILENAME = '.shell-hash';

/**
 * Walk a directory tree and return absolute file paths, sorted by their
 * repo-relative posix path. Returns `[]` if `root` does not exist.
 */
function listFilesSorted(root: string, repoRoot: string): string[] {
    if (!fs.existsSync(root)) return [];
    const collected: string[] = [];
    const stack: string[] = [root];
    while (stack.length > 0) {
        const dir = stack.pop()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
            } else if (entry.isFile()) {
                collected.push(full);
            }
        }
    }
    collected.sort((a, b) => {
        const ra = path.relative(repoRoot, a).replace(/\\/g, '/');
        const rb = path.relative(repoRoot, b).replace(/\\/g, '/');
        return ra < rb ? -1 : ra > rb ? 1 : 0;
    });
    return collected;
}

/**
 * Compute a stable sha256 hex digest over the shell source + bundled
 * assets. The digest is platform-independent: paths are normalized to
 * posix before being fed into the hash, file ordering is sorted by the
 * normalized path, and contents are read as raw buffers.
 */
export function computeShellHash(extensionRoot: string): string {
    const hash = createHash('sha256');

    // 1. shell.ts and shell-assets.ts — the renderer + its manifest. If
    //    either file is missing we still produce a deterministic digest
    //    (the missing-file marker enters the hash so a future appearance
    //    invalidates correctly).
    const shellFiles = [
        path.join(extensionRoot, 'src', 'webview', 'shell.ts'),
        path.join(extensionRoot, 'src', 'webview', 'shell-assets.ts'),
    ];
    for (const file of shellFiles) {
        const rel = path.relative(extensionRoot, file).replace(/\\/g, '/');
        hash.update(rel);
        hash.update('\0');
        if (fs.existsSync(file)) {
            hash.update(fs.readFileSync(file));
        } else {
            hash.update('<missing>');
        }
        hash.update('\0');
    }

    // 2. Bundled assets. Mirror the `useDistWebview` selection in
    //    generator.ts — prefer dist/webview/ when present, otherwise hash
    //    the source styles/libs/ui directories so the dev render path
    //    invalidates on edits to UI source too.
    const distWebview = path.join(extensionRoot, 'dist', 'webview');
    const assetRoots: string[] = fs.existsSync(distWebview)
        ? [distWebview]
        : [
              path.join(extensionRoot, 'src', 'webview', 'styles'),
              path.join(extensionRoot, 'src', 'webview', 'libs'),
              path.join(extensionRoot, 'src', 'webview', 'ui'),
          ];

    for (const root of assetRoots) {
        for (const file of listFilesSorted(root, extensionRoot)) {
            const rel = path.relative(extensionRoot, file).replace(/\\/g, '/');
            hash.update(rel);
            hash.update('\0');
            try {
                hash.update(fs.readFileSync(file));
            } catch {
                hash.update('<unreadable>');
            }
            hash.update('\0');
        }
    }

    return hash.digest('hex');
}

/**
 * Read the previously-recorded hash from `<destinationDir>/.shell-hash`,
 * or `null` if the file does not exist or cannot be read.
 */
export function readCachedShellHash(destinationDir: string): string | null {
    const hashPath = path.join(destinationDir, HASH_FILENAME);
    try {
        return fs.readFileSync(hashPath, 'utf8').trim();
    } catch {
        return null;
    }
}

/** Persist `hash` to `<destinationDir>/.shell-hash`. */
export function writeCachedShellHash(destinationDir: string, hash: string): void {
    const hashPath = path.join(destinationDir, HASH_FILENAME);
    fs.writeFileSync(hashPath, hash, 'utf8');
}

/**
 * If the cached hash differs from `currentHash`, blow away
 * `<destinationDir>` (recursive, force) and return `true`. If the hashes
 * match (or there is no cached hash but the directory is empty / fresh)
 * return `false` and leave the directory intact.
 *
 * Note: when `readCachedShellHash` returns `null` we treat that as a
 * mismatch ONLY if the directory has any files — a pristine empty
 * directory is by definition not stale.
 */
export function invalidateIfStale(destinationDir: string, currentHash: string): boolean {
    const cached = readCachedShellHash(destinationDir);
    if (cached === currentHash) return false;

    // Empty / missing directory is not stale — there is nothing to remove.
    if (!fs.existsSync(destinationDir)) return false;
    let entries: string[];
    try {
        entries = fs.readdirSync(destinationDir);
    } catch {
        return false;
    }
    if (entries.length === 0) return false;

    fs.rmSync(destinationDir, { recursive: true, force: true });
    return true;
}
