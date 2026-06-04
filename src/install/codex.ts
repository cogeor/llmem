/**
 * Codex client adapter for `llmem install`.
 *
 * Codex stores its MCP server registrations in a TOML config at
 * `~/.codex/config.toml`, under the `[mcp_servers.<name>]` table convention:
 *
 *   [mcp_servers.llmem]
 *   command = "npx"
 *   args = [ "-y", "@cogeor/llmem", "mcp" ]
 *   # optional, when a workspace is pinned:
 *   [mcp_servers.llmem.env]
 *   LLMEM_WORKSPACE = "/path/to/workspace"
 *
 * Format verified against Codex config docs as of 2026-06. The `~/.codex/
 * config.toml` path and the `[mcp_servers.<name>]` table shape (command / args
 * / optional env) are the VERIFIED current format. There is no live `codex`
 * binary in CI, so the WRITE path (read → mergeTomlServer → write) is the
 * golden-tested surface (tests/unit/install/fixtures/codex.expected.toml);
 * the PATH-detection branch and any native-CLI aspects are manual-smoke only.
 *
 * Unlike the Claude Code adapter (which prefers a native `claude mcp add` CLI),
 * Codex has no first-party "add an MCP server" command we rely on, so this
 * adapter ALWAYS writes/merges the TOML file directly. We never clobber a file
 * we cannot parse: malformed existing TOML ⇒ status 'error', file untouched.
 *
 * Injectable seams (mirroring the Claude Code adapter's style) keep this
 * unit-testable without a real `codex` binary or a real HOME:
 *   - `pathProbe` — PATH probe for `codex` (defaults to `commandOnPath`).
 *   - `homeOf`    — resolve the user's home dir from an env (defaults to
 *                   `env.HOME ?? env.USERPROFILE ?? os.homedir()`); tests point
 *                   it at a temp dir so writes never touch the real `~/.codex`.
 *   - `io`        — `{ readFile, writeFile, mkdir }` over the resolved config
 *                   path (defaults to `fs.promises`); the test points it at a
 *                   temp dir.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

import { commandOnPath } from './detect';
import { mergeTomlServer } from './registration';
import type {
    ApplyOpts,
    ApplyResult,
    ClientAdapter,
    DetectResult,
    Payload,
} from './types';

// ----------------------------------------------------------------------------
// Injectable seams
// ----------------------------------------------------------------------------

/** Resolves `true` when a binary is on PATH. */
export type PathProbe = (name: string) => Promise<boolean>;

/** Resolve the user's home directory from an environment. */
export type HomeResolver = (env: NodeJS.ProcessEnv) => string | undefined;

/** Minimal fs seam over the resolved `~/.codex/config.toml` path. */
export interface CodexFsIo {
    readFile(p: string): Promise<string>;
    writeFile(p: string, data: string): Promise<void>;
    mkdir(p: string): Promise<void>;
}

/** Optional injected seams; every field defaults to the real implementation. */
export interface CodexSeams {
    pathProbe?: PathProbe;
    homeOf?: HomeResolver;
    io?: CodexFsIo;
}

const SERVER_NAME = 'llmem';

/** Relative config location under the user's home directory. */
const CODEX_DIR = '.codex';
const CODEX_CONFIG = 'config.toml';

const defaultHomeOf: HomeResolver = (env) =>
    env.HOME ?? env.USERPROFILE ?? os.homedir();

const defaultIo: CodexFsIo = {
    readFile: (p) => fs.readFile(p, 'utf8'),
    writeFile: (p, data) => fs.writeFile(p, data, 'utf8'),
    mkdir: (p) => fs.mkdir(p, { recursive: true }).then(() => undefined),
};

// ----------------------------------------------------------------------------
// snippet
// ----------------------------------------------------------------------------

/**
 * The copy-pasteable `[mcp_servers.llmem]` TOML block for `--print` / manual
 * setup. Produced via the same smol-toml serializer the apply path uses (so
 * the snippet is byte-identical to what we would write). Pure — writes nothing.
 */
function buildSnippet(payload: Payload): string {
    // Merge into an empty doc → the canonical single-table rendering.
    return mergeTomlServer('', SERVER_NAME, payload, false).next;
}

// ----------------------------------------------------------------------------
// apply
// ----------------------------------------------------------------------------

async function applyCodex(
    payload: Payload,
    opts: ApplyOpts,
    homeOf: HomeResolver,
    io: CodexFsIo,
    env: NodeJS.ProcessEnv,
): Promise<ApplyResult> {
    const home = homeOf(env);
    if (!home) {
        return {
            status: 'error',
            detail:
                'Could not resolve a home directory for ~/.codex/config.toml. ' +
                'Re-run with --print and apply the snippet manually.',
        };
    }
    const dir = path.join(home, CODEX_DIR);
    const file = path.join(dir, CODEX_CONFIG);

    // Read existing config, tolerating a missing file (treat as empty doc).
    let existing = '';
    try {
        existing = await io.readFile(file);
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
            const e = err as NodeJS.ErrnoException;
            return {
                status: 'error',
                detail: `Could not read ${file} (${e.code ?? 'unknown'}${e.errno != null ? `, errno ${e.errno}` : ''}). Re-run with --print and apply the snippet manually.`,
            };
        }
        existing = '';
    }

    // Parse + merge. Malformed existing TOML ⇒ NEVER clobber.
    let next: string;
    let status: 'added' | 'replaced' | 'skipped';
    try {
        const merged = mergeTomlServer(existing, SERVER_NAME, payload, opts.force);
        next = merged.next;
        status = merged.status;
    } catch {
        return {
            status: 'error',
            detail: `Existing ${file} is not valid TOML; refusing to overwrite it. Re-run with --print and merge the snippet manually.`,
        };
    }

    if (status === 'skipped') {
        return {
            status: 'skipped',
            detail: `${file} already registers "${SERVER_NAME}" (use --force to replace).`,
        };
    }

    // Create ~/.codex/ if absent, then write the merged config.
    try {
        await io.mkdir(dir);
        await io.writeFile(file, next);
    } catch (err) {
        const e = err as NodeJS.ErrnoException;
        return {
            status: 'error',
            detail: `Permission denied writing ${file} (${e.code ?? 'unknown'}${e.errno != null ? `, errno ${e.errno}` : ''}). Re-run with --print and apply the snippet manually.`,
        };
    }

    return {
        status,
        detail: `${status === 'replaced' ? 'Replaced' : 'Added'} "${SERVER_NAME}" in ${file}.`,
    };
}

// ----------------------------------------------------------------------------
// Adapter factory
// ----------------------------------------------------------------------------

/**
 * Build the Codex adapter. Pass `seams` to override PATH probing, home
 * resolution, or fs in tests; production uses the defaults.
 */
export function createCodexAdapter(seams: CodexSeams = {}): ClientAdapter {
    const pathProbe: PathProbe = seams.pathProbe ?? ((name) => commandOnPath(name));
    const homeOf: HomeResolver = seams.homeOf ?? defaultHomeOf;
    const io: CodexFsIo = seams.io ?? defaultIo;

    return {
        id: 'codex',
        label: 'Codex',

        async detect(env: NodeJS.ProcessEnv): Promise<DetectResult> {
            if (await pathProbe('codex')) {
                return { present: true, via: 'path' };
            }
            const home = homeOf(env);
            if (home) {
                const configPath = path
                    .join(home, CODEX_DIR, CODEX_CONFIG)
                    .replaceAll('\\', '/');
                const exists = await io
                    .readFile(configPath)
                    .then(() => true, () => false);
                if (exists) {
                    return { present: true, via: 'config', configPath };
                }
            }
            return { present: false };
        },

        async apply(payload: Payload, opts: ApplyOpts): Promise<ApplyResult> {
            return applyCodex(payload, opts, homeOf, io, process.env);
        },

        snippet(payload: Payload): string {
            return buildSnippet(payload);
        },
    };
}

/** Default Codex adapter instance, wired to the real environment. */
export const codexAdapter: ClientAdapter = createCodexAdapter();
