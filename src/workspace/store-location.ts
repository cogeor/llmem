/**
 * Global per-user artifact store location (portable store, P1).
 *
 * `resolveGlobalStoreRoot` maps a workspace root to a stable per-user
 * store directory — `<base>/llmem/store/<name>-<hash8>/graph` — the same
 * keying scheme Bazel / pre-commit / JetBrains indexes use for tools that
 * analyze foreign codebases without writing into them:
 *
 *   - `<base>`  — `LLMEM_STORE_DIR` env override when set; else
 *                 win32: `%LOCALAPPDATA%` (fallback `~/AppData/Local`),
 *                 POSIX: `$XDG_CACHE_HOME` (fallback `~/.cache`).
 *   - `<hash8>` — first 8 hex chars of sha256 of the canonical workspace
 *                 path (`fs.realpathSync` when the dir exists, else
 *                 `path.resolve`; lowercased before hashing on win32 only,
 *                 where the filesystem is case-insensitive).
 *   - `<name>`  — workspace basename sanitized to `[a-z0-9-]` for human
 *                 recognizability when browsing the store.
 *
 * `resolveArtifactRootPrecedence` is the single owner of the effective
 * artifact-root chain shared by the CLI (`cli/context.ts`) and the MCP
 * server (`mcp/config.ts`):
 *
 *   `--artifact-root` flag > `LLMEM_ARTIFACT_ROOT` env >
 *   `--store global` flag / `LLMEM_STORE=global` env > default
 *   (`.llmem/graph`; an explicit `--store repo` beats `LLMEM_STORE=global`).
 *
 * Pure aside from the realpath probe; platform/env/homedir are injectable
 * seams so both platform branches are unit-testable on any host.
 * Lives in `src/workspace/` (leaf layer): imports core-adjacent
 * `config-defaults` only, like `detect.ts`.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ENV_VARS } from '../config-defaults';

/** Injectable host seams (tests exercise both platform branches). */
export interface StoreSeams {
    readonly platform?: NodeJS.Platform;
    readonly env?: NodeJS.ProcessEnv;
    readonly homedir?: () => string;
}

/** Where artifacts live when no explicit root is given. */
export type StoreMode = 'repo' | 'global';

/** Sanitize a workspace basename to `[a-z0-9-]` (runs collapse to one `-`). */
function sanitizeStoreName(basename: string): string {
    const sanitized = basename
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return sanitized || 'workspace';
}

/**
 * Resolve the per-user global store root for one workspace.
 * See the module banner for the `<base>/llmem/store/<name>-<hash8>/graph`
 * scheme. Does not create the directory (context creation `mkdir -p`s it).
 */
export function resolveGlobalStoreRoot(
    workspaceRootAbs: string,
    seams: StoreSeams = {},
): string {
    const platform = seams.platform ?? process.platform;
    const env = seams.env ?? process.env;
    const homedir = seams.homedir ?? os.homedir;

    // Canonical key: realpath when the dir exists (symlink/8.3-name-stable),
    // plain resolve otherwise.
    let canonical: string;
    try {
        canonical = fs.realpathSync(workspaceRootAbs);
    } catch {
        canonical = path.resolve(workspaceRootAbs);
    }

    // win32 filesystems are case-insensitive: `C:\Foo` and `c:\foo` must key
    // to the SAME store, so lowercase before hashing there (only there —
    // POSIX paths are case-sensitive and must stay distinct).
    const hashInput = platform === 'win32' ? canonical.toLowerCase() : canonical;
    const hash8 = crypto
        .createHash('sha256')
        .update(hashInput)
        .digest('hex')
        .slice(0, 8);
    const name = sanitizeStoreName(path.basename(canonical));

    const base =
        env[ENV_VARS.STORE_DIR] ||
        (platform === 'win32'
            ? env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local')
            : env.XDG_CACHE_HOME || path.join(homedir(), '.cache'));

    return path.join(base, 'llmem', 'store', `${name}-${hash8}`, 'graph');
}

/**
 * Effective artifact root under the full precedence chain (module banner).
 * Returns `undefined` when the default (`.llmem/graph` under the workspace)
 * applies — callers then simply omit the config override.
 */
export function resolveArtifactRootPrecedence(opts: {
    readonly workspaceRoot: string;
    /** `--artifact-root` flag value (highest precedence). */
    readonly flagArtifactRoot?: string;
    /** `LLMEM_ARTIFACT_ROOT` env value. */
    readonly envArtifactRoot?: string;
    /** `--store` flag value (an explicit `repo` beats `LLMEM_STORE=global`). */
    readonly flagStore?: StoreMode;
    /** `LLMEM_STORE` env value (non-`'global'` values are ignored). */
    readonly envStore?: string;
    readonly seams?: StoreSeams;
}): string | undefined {
    if (opts.flagArtifactRoot) return opts.flagArtifactRoot;
    if (opts.envArtifactRoot) return opts.envArtifactRoot;
    const mode: StoreMode =
        opts.flagStore ?? (opts.envStore === 'global' ? 'global' : 'repo');
    if (mode === 'global') {
        return resolveGlobalStoreRoot(opts.workspaceRoot, opts.seams);
    }
    return undefined;
}
