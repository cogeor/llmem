/**
 * Detection helpers for the `llmem install` command — "is this client even
 * here?" probes that stay fs/PATH-free at import time and injectable at call
 * time.
 *
 * Two concerns:
 *   1. `commandOnPath` — is a binary resolvable on the user's PATH?
 *      Cross-platform: `where` on win32, `which` on posix. Mirrors
 *      `server/open-browser.ts`'s `execFile` + `process.platform` branch.
 *   2. `configFileExists` — does a client's config file already exist?
 *      Takes an injectable env + fs probe so tests never read a real HOME.
 *
 * Both helpers expose injectable seams (runner / platform / fs / env) so the
 * unit tests in `tests/unit/install/` can exercise every branch without
 * spawning real binaries or touching the real home directory.
 */

import { execFile } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Signature for the process runner `commandOnPath` uses to probe PATH.
 * Resolves `true` when the probe command exits 0 (binary found), `false`
 * otherwise. Never rejects — a non-zero exit (e.g. win32 `where` when the
 * name is absent) is "not found", not an error.
 */
export type CommandRunner = (
    cmd: string,
    args: string[],
) => Promise<boolean>;

/**
 * Default runner: spawn the platform probe and resolve on its exit code.
 * win32 `where` returns non-zero (1/2) when the name is absent — we treat any
 * non-zero exit, and any spawn error, as "not found".
 */
const defaultRunner: CommandRunner = (cmd, args) =>
    new Promise((resolve) => {
        execFile(cmd, args, (error) => {
            resolve(!error);
        });
    });

/**
 * Is `name` resolvable on the user's PATH?
 *
 * - win32: `where <name>` (non-zero exit ⇒ absent, treated as `false`).
 * - posix: `which <name>`.
 *
 * @param name     binary to look for (e.g. `llmem`).
 * @param runner   injectable process runner (defaults to a real `execFile`).
 * @param platform injectable platform string (defaults to `process.platform`)
 *                 so tests can exercise both branches without reassigning the
 *                 read-only `process.platform`.
 */
export async function commandOnPath(
    name: string,
    runner: CommandRunner = defaultRunner,
    platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
    if (platform === 'win32') {
        return runner('where', [name]);
    }
    return runner('which', [name]);
}

/**
 * Minimal async fs probe seam: does a path exist? Injected into
 * `configFileExists` so tests can stub it.
 */
export type FileExistsFn = (filePath: string) => Promise<boolean>;

/** Default existence probe — `fs.stat`, swallowing ENOENT to `false`. */
const defaultFileExists: FileExistsFn = (filePath) =>
    fs.stat(filePath).then(() => true, () => false);

/**
 * Known client config-file locations, relative to the user's home directory.
 * Used by `configFileExists`. Kept here (not in the adapters) so detection is
 * a single, testable lookup table.
 */
export const CLIENT_CONFIG_RELPATHS: Record<string, string[]> = {
    codex: ['.codex/config.toml'],
    claude: ['.claude.json'],
    // Desktop config path is platform-specific; the real path is resolved by
    // the adapter (LI-04). This entry covers the common posix-ish fallback so
    // detection has *something* to probe; adapters may override.
    'claude-desktop': [
        '.config/Claude/claude_desktop_config.json',
        'Library/Application Support/Claude/claude_desktop_config.json',
    ],
};

/**
 * Does a config file exist for the given client?
 *
 * Resolves each candidate relpath against the home directory (from the
 * injected `env.HOME` / `env.USERPROFILE`, falling back to `os.homedir()`),
 * and reports the first that exists.
 *
 * @returns the matching forward-slash-normalized path, or `null` if none.
 */
export async function configFileExists(
    relPaths: string[],
    env: NodeJS.ProcessEnv = process.env,
    fileExists: FileExistsFn = defaultFileExists,
): Promise<string | null> {
    const home = env.HOME ?? env.USERPROFILE ?? os.homedir();
    for (const rel of relPaths) {
        const full = path.join(home, rel);
        if (await fileExists(full)) {
            return full.replaceAll('\\', '/');
        }
    }
    return null;
}
