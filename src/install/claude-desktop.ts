/**
 * Claude Desktop client adapter for `llmem install`.
 *
 * Claude Desktop stores its MCP server registrations in a per-OS JSON config:
 *
 *   - macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json
 *   - Windows: %APPDATA%\Claude\claude_desktop_config.json
 *   - Linux:   ~/.config/Claude/claude_desktop_config.json
 *
 * The shape is the conventional `mcpServers` map:
 *
 *   { "mcpServers": { "llmem": { command, args, env: { LLMEM_WORKSPACE } } } }
 *
 * Format + per-OS path verified against the Claude Desktop MCP docs as of
 * 2026-06. There is no live Claude Desktop install in CI, so the WRITE path
 * (read → mergeJsonServer → write) is the golden-tested surface
 * (tests/unit/install/fixtures/claude-desktop.expected.json).
 *
 * PHASE-2 DISTINCTION — Desktop is NOT project-aware. Unlike Claude Code
 * (which can register a project-local `.mcp.json` carrying the cwd) or Codex
 * (which a user runs from inside a project), Claude Desktop launches the MCP
 * server with no project cwd. So this adapter ALWAYS bakes
 * `env.LLMEM_WORKSPACE` into the registration: it pins the workspace from
 * `opts.workspace`, falling back to auto-detection from the cwd
 * (`detectWorkspace`) with a WARNING that the workspace is pinned. The shared
 * `buildPayload` only adds the env when a workspace is set, so this adapter
 * re-derives a workspace and AUGMENTS the payload's env regardless of how it
 * was built — Desktop's registration is never workspace-less. Other adapters
 * are unaffected.
 *
 * We never clobber a file we cannot parse: malformed existing JSON ⇒ status
 * 'error', file untouched. Idempotency: present + !force ⇒ skipped; present +
 * force ⇒ replaced.
 *
 * Injectable seams (mirroring the Codex adapter's style) keep this
 * unit-testable without a real Claude Desktop or a real HOME/APPDATA:
 *   - `pathProbe`   — present for symmetry; Desktop has no CLI on PATH, so the
 *                     signal is config-presence (detect reads the config path).
 *   - `platformOf`  — resolve the platform (defaults to `process.platform`) so
 *                     tests can assert the macOS / Windows / Linux path branch.
 *   - `homeOf`      — resolve the user's home dir (defaults to
 *                     `env.HOME ?? env.USERPROFILE ?? os.homedir()`); used on
 *                     macOS/Linux. On win32 the APPDATA env is used instead.
 *   - `workspaceOf` — resolve the pinned/auto-detected workspace (defaults to
 *                     `detectWorkspace`).
 *   - `warn`        — sink for the "workspace pinned" warning (defaults to
 *                     `console.warn`); tests capture it.
 *   - `io`          — `{ readFile, writeFile, mkdir }` over the resolved config
 *                     path (defaults to `fs.promises`); the test points it at a
 *                     temp dir.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

import { commandOnPath } from './detect';
import { mergeJsonServer } from './registration';
import { detectWorkspace } from '../workspace';
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

/** Resolve a workspace root from an optional explicit hint. */
export type WorkspaceResolver = (explicit?: string) => string;

/** Warning sink (defaults to `console.warn`). */
export type WarnFn = (message: string) => void;

/** Minimal fs seam over the resolved config path. */
export interface DesktopFsIo {
    readFile(p: string): Promise<string>;
    writeFile(p: string, data: string): Promise<void>;
    mkdir(p: string): Promise<void>;
}

/** Optional injected seams; every field defaults to the real implementation. */
export interface ClaudeDesktopSeams {
    pathProbe?: PathProbe;
    platformOf?: () => NodeJS.Platform;
    homeOf?: HomeResolver;
    workspaceOf?: WorkspaceResolver;
    warn?: WarnFn;
    io?: DesktopFsIo;
}

const SERVER_NAME = 'llmem';

/** Config directory + filename, relative to the resolved base directory. */
const DESKTOP_DIR = 'Claude';
const DESKTOP_CONFIG = 'claude_desktop_config.json';

const defaultHomeOf: HomeResolver = (env) =>
    env.HOME ?? env.USERPROFILE ?? os.homedir();

const defaultIo: DesktopFsIo = {
    readFile: (p) => fs.readFile(p, 'utf8'),
    writeFile: (p, data) => fs.writeFile(p, data, 'utf8'),
    mkdir: (p) => fs.mkdir(p, { recursive: true }).then(() => undefined),
};

// ----------------------------------------------------------------------------
// Per-OS config path resolution
// ----------------------------------------------------------------------------

/**
 * Resolve the absolute `Claude/` config directory for the running platform.
 *
 * - win32: `%APPDATA%\Claude`
 * - darwin: `~/Library/Application Support/Claude`
 * - else (linux/posix): `~/.config/Claude`
 *
 * Returns `null` when the required base (APPDATA on win32, HOME elsewhere)
 * cannot be resolved.
 */
export function resolveDesktopDir(
    platform: NodeJS.Platform,
    env: NodeJS.ProcessEnv,
    homeOf: HomeResolver,
): string | null {
    if (platform === 'win32') {
        const appData = env.APPDATA;
        if (!appData) {
            return null;
        }
        return path.join(appData, DESKTOP_DIR);
    }

    const home = homeOf(env);
    if (!home) {
        return null;
    }

    if (platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', DESKTOP_DIR);
    }

    return path.join(home, '.config', DESKTOP_DIR);
}

/** Resolve the absolute config FILE path (or `null` if the base is missing). */
function resolveDesktopConfig(
    platform: NodeJS.Platform,
    env: NodeJS.ProcessEnv,
    homeOf: HomeResolver,
): string | null {
    const dir = resolveDesktopDir(platform, env, homeOf);
    return dir ? path.join(dir, DESKTOP_CONFIG) : null;
}

// ----------------------------------------------------------------------------
// Workspace baking — Desktop ALWAYS carries env.LLMEM_WORKSPACE
// ----------------------------------------------------------------------------

/**
 * Produce a payload that is GUARANTEED to carry `env.LLMEM_WORKSPACE`.
 *
 * Desktop has no project cwd, so the registration must pin a workspace. We use
 * `opts.workspace` when supplied; otherwise we auto-detect from the cwd and
 * warn that the resolved path is being pinned. The input payload is never
 * mutated — we return a shallow clone with the env augmented.
 */
function bakeWorkspace(
    payload: Payload,
    opts: ApplyOpts,
    workspaceOf: WorkspaceResolver,
    warn: WarnFn,
): Payload {
    let workspace = opts.workspace;
    if (!workspace) {
        workspace = workspaceOf();
        warn(
            `Claude Desktop is not project-aware; pinning LLMEM_WORKSPACE to ` +
                `the auto-detected workspace "${workspace.replaceAll('\\', '/')}". ` +
                `Pass --workspace <path> to pin a different root.`,
        );
    }

    return {
        command: payload.command,
        args: [...payload.args],
        env: { ...payload.env, LLMEM_WORKSPACE: workspace },
    };
}

// ----------------------------------------------------------------------------
// snippet
// ----------------------------------------------------------------------------

/**
 * The copy-pasteable `claude_desktop_config.json` block for `--print` / manual
 * setup: `{ "mcpServers": { "llmem": <payload> } }`, pretty-printed (2-space
 * indent, trailing newline). Pure — writes nothing.
 *
 * Note: the snippet reflects the payload AS GIVEN (it does not auto-detect a
 * workspace) — that side-effecting baking happens only on the `apply` path.
 */
function buildSnippet(payload: Payload): string {
    const entry: Payload = { command: payload.command, args: [...payload.args] };
    if (payload.env) {
        entry.env = { ...payload.env };
    }
    const block = { mcpServers: { [SERVER_NAME]: entry } };
    return JSON.stringify(block, null, 2) + '\n';
}

// ----------------------------------------------------------------------------
// apply
// ----------------------------------------------------------------------------

async function applyDesktop(
    payload: Payload,
    opts: ApplyOpts,
    platform: NodeJS.Platform,
    env: NodeJS.ProcessEnv,
    homeOf: HomeResolver,
    workspaceOf: WorkspaceResolver,
    warn: WarnFn,
    io: DesktopFsIo,
): Promise<ApplyResult> {
    const dir = resolveDesktopDir(platform, env, homeOf);
    const file = resolveDesktopConfig(platform, env, homeOf);
    if (!dir || !file) {
        return {
            status: 'error',
            detail:
                'Could not resolve the Claude Desktop config directory ' +
                `(${platform === 'win32' ? 'APPDATA' : 'HOME'} is unset). ` +
                'Re-run with --print and apply the snippet manually.',
        };
    }

    // Desktop ALWAYS bakes env.LLMEM_WORKSPACE (phase-2: no project cwd).
    const baked = bakeWorkspace(payload, opts, workspaceOf, warn);

    // Read existing config, tolerating a missing file (treat as empty object).
    let existingRaw: string | null = null;
    try {
        existingRaw = await io.readFile(file);
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
            const e = err as NodeJS.ErrnoException;
            return {
                status: 'error',
                detail: `Could not read ${file} (${e.code ?? 'unknown'}${e.errno != null ? `, errno ${e.errno}` : ''}). Re-run with --print and apply the snippet manually.`,
            };
        }
        existingRaw = null;
    }

    let parsed: unknown = {};
    if (existingRaw !== null && existingRaw.trim().length > 0) {
        try {
            parsed = JSON.parse(existingRaw);
        } catch {
            // NEVER clobber a file we cannot parse.
            return {
                status: 'error',
                detail: `Existing ${file} is not valid JSON; refusing to overwrite it. Re-run with --print and merge the snippet manually.`,
            };
        }
    }

    const { next, status } = mergeJsonServer(parsed, SERVER_NAME, baked, opts.force);

    if (status === 'skipped') {
        return {
            status: 'skipped',
            detail: `${file} already registers "${SERVER_NAME}" (use --force to replace).`,
        };
    }

    // Create the Claude/ parent dir if absent, then write the merged config.
    const out = JSON.stringify(next, null, 2) + '\n';
    try {
        await io.mkdir(dir);
        await io.writeFile(file, out);
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
 * Build the Claude Desktop adapter. Pass `seams` to override platform/home/
 * workspace resolution, the warn sink, or fs in tests; production uses the
 * defaults.
 */
export function createClaudeDesktopAdapter(
    seams: ClaudeDesktopSeams = {},
): ClientAdapter {
    const pathProbe: PathProbe = seams.pathProbe ?? ((name) => commandOnPath(name));
    const platformOf = seams.platformOf ?? (() => process.platform);
    const homeOf: HomeResolver = seams.homeOf ?? defaultHomeOf;
    const workspaceOf: WorkspaceResolver = seams.workspaceOf ?? detectWorkspace;
    // User-facing one-line warning surfaced when the workspace is auto-pinned.
    // Routed through console.warn by default (the install command is a CLI
    // surface); injectable so unit tests capture it without writing to stderr.
    // eslint-disable-next-line no-console
    const warn: WarnFn = seams.warn ?? ((m) => console.warn(m));
    const io: DesktopFsIo = seams.io ?? defaultIo;

    void pathProbe; // Desktop has no CLI on PATH; kept as a symmetry seam.

    return {
        id: 'claude-desktop',
        label: 'Claude Desktop',

        async detect(env: NodeJS.ProcessEnv): Promise<DetectResult> {
            // Desktop has no CLI on PATH typically — config-presence is the
            // signal. Probe the per-OS config path.
            const configPath = resolveDesktopConfig(platformOf(), env, homeOf);
            if (configPath) {
                const exists = await io
                    .readFile(configPath)
                    .then(() => true, () => false);
                if (exists) {
                    return {
                        present: true,
                        via: 'config',
                        configPath: configPath.replaceAll('\\', '/'),
                    };
                }
            }
            return { present: false };
        },

        async apply(payload: Payload, opts: ApplyOpts): Promise<ApplyResult> {
            return applyDesktop(
                payload,
                opts,
                platformOf(),
                process.env,
                homeOf,
                workspaceOf,
                warn,
                io,
            );
        },

        snippet(payload: Payload): string {
            return buildSnippet(payload);
        },
    };
}

/** Default Claude Desktop adapter instance, wired to the real environment. */
export const claudeDesktopAdapter: ClientAdapter = createClaudeDesktopAdapter();
