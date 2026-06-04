/**
 * Claude Code client adapter for `llmem install`.
 *
 * Two registration paths, in preference order:
 *
 *   1. NATIVE (preferred) — when the `claude` CLI is on PATH, register via the
 *      first-party command:
 *        `claude mcp add llmem -s <scope> -- <command> <args...>`
 *      Idempotency is probed with `claude mcp get llmem` (older builds without
 *      `mcp get` fall back to parsing `claude mcp list`). Present + !force ⇒
 *      skipped; present + force ⇒ `claude mcp remove llmem -s <scope>` then add
 *      ⇒ replaced. Scope/command/args are passed as an execFile arg ARRAY — no
 *      shell, no string interpolation, no injection surface.
 *
 *   2. FALLBACK — when `claude` is absent, write/merge a PROJECT-LOCAL
 *      `.mcp.json` in the detected workspace, shape:
 *        { "mcpServers": { "llmem": { command, args, env? } } }
 *      We NEVER touch `~/.claude.json` directly; the CLI owns the user-scope
 *      file. Malformed existing `.mcp.json` is reported (status 'error') and
 *      left untouched — we never clobber a file we cannot parse.
 *
 * Format verified against Claude Code MCP docs as of 2026-06. Native CLI shape
 * (`claude mcp add <name> -s <scope> -- <cmd> <args...>`) and the project
 * `.mcp.json` `{ mcpServers: { <name>: { command, args } } }` shape are the
 * VERIFIED current formats. Since no live `claude` binary exists in CI, only
 * the `.mcp.json` merge path is golden-tested; the native path is
 * manual-smoke only.
 *
 * Injectable seams (mirroring LI-01's style) keep this unit-testable without a
 * real `claude` binary or a real workspace:
 *   - `pathProbe`    — PATH probe for `claude` (defaults to `commandOnPath`);
 *                      the test forces `false` to take the fallback.
 *   - `runClaude`    — native CLI runner (defaults to a real `execFile`);
 *                      unused on the tested fallback path.
 *   - `workspaceOf`  — resolve the project root (defaults to `detectWorkspace`).
 *   - `io`           — `{ readFile, writeFile }` over the resolved `.mcp.json`
 *                      (defaults to `fs.promises`); the test points it at a
 *                      temp dir.
 */

import { execFile } from 'child_process';
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

/**
 * Native `claude` CLI runner. Resolves with the exit code and captured stdout
 * so the adapter can both check idempotency (`mcp get` / `mcp list`) and act on
 * exit status. Never rejects — a non-zero exit is data, not an exception.
 */
export type ClaudeRunner = (
    args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

/** Resolve a workspace root from an optional explicit hint. */
export type WorkspaceResolver = (explicit?: string) => string;

/** Minimal fs seam over the resolved `.mcp.json` path. */
export interface FsIo {
    readFile(p: string): Promise<string>;
    writeFile(p: string, data: string): Promise<void>;
}

/** Optional injected seams; every field defaults to the real implementation. */
export interface ClaudeCodeSeams {
    pathProbe?: PathProbe;
    runClaude?: ClaudeRunner;
    workspaceOf?: WorkspaceResolver;
    io?: FsIo;
}

const SERVER_NAME = 'llmem';

/** Default native runner: spawn `claude <args...>`, capture exit/stdout. */
const defaultRunClaude: ClaudeRunner = (args) =>
    new Promise((resolve) => {
        execFile('claude', args, (error, stdout, stderr) => {
            const code =
                error && typeof (error as { code?: unknown }).code === 'number'
                    ? ((error as { code: number }).code)
                    : error
                      ? 1
                      : 0;
            resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
        });
    });

const defaultIo: FsIo = {
    readFile: (p) => fs.readFile(p, 'utf8'),
    writeFile: (p, data) => fs.writeFile(p, data, 'utf8'),
};

// ----------------------------------------------------------------------------
// snippet
// ----------------------------------------------------------------------------

/**
 * The copy-pasteable `.mcp.json` block for `--print` / manual setup:
 * `{ "mcpServers": { "llmem": <payload> } }`, pretty-printed (2-space indent,
 * trailing newline). Pure — writes nothing.
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
// Native CLI helpers
// ----------------------------------------------------------------------------

/**
 * Probe whether `llmem` is already registered with the native CLI. Prefers
 * `claude mcp get llmem`; on an older `claude` that lacks `mcp get` (exit ≠ 0
 * with a "get"-related complaint), fall back to scanning `claude mcp list`.
 * Returns `true` when present, `false` when absent.
 */
async function nativePresent(run: ClaudeRunner): Promise<boolean> {
    const get = await run(['mcp', 'get', SERVER_NAME]);
    if (get.code === 0) {
        return true;
    }
    // `mcp get` of a missing server exits non-zero; distinguish "missing
    // server" from "missing subcommand" via the list fallback when the CLI
    // doesn't understand `get` at all.
    const looksUnsupported =
        /unknown command|unrecognized|did you mean|usage:/i.test(
            `${get.stderr}${get.stdout}`,
        );
    if (looksUnsupported) {
        const list = await run(['mcp', 'list']);
        if (list.code === 0) {
            return new RegExp(`(^|[^\\w])${SERVER_NAME}([^\\w]|$)`, 'm').test(
                list.stdout,
            );
        }
    }
    return false;
}

/** Build the `claude mcp add` arg array (no shell, no interpolation). */
function nativeAddArgs(scope: string, payload: Payload): string[] {
    return [
        'mcp',
        'add',
        SERVER_NAME,
        '-s',
        scope,
        '--',
        payload.command,
        ...payload.args,
    ];
}

async function applyNative(
    payload: Payload,
    opts: ApplyOpts,
    run: ClaudeRunner,
): Promise<ApplyResult> {
    const present = await nativePresent(run);

    if (present && !opts.force) {
        return {
            status: 'skipped',
            detail: `Claude Code already has an MCP server named "${SERVER_NAME}" (use --force to replace).`,
        };
    }

    if (present && opts.force) {
        const removed = await run(['mcp', 'remove', SERVER_NAME, '-s', opts.scope]);
        if (removed.code !== 0) {
            return {
                status: 'error',
                detail: `claude mcp remove failed (exit ${removed.code}): ${(removed.stderr || removed.stdout).trim()}`,
            };
        }
    }

    const added = await run(nativeAddArgs(opts.scope, payload));
    if (added.code !== 0) {
        return {
            status: 'error',
            detail: `claude mcp add failed (exit ${added.code}): ${(added.stderr || added.stdout).trim()}`,
        };
    }

    return {
        status: present ? 'replaced' : 'added',
        detail: `Registered "${SERVER_NAME}" with Claude Code via \`claude mcp add\` (scope: ${opts.scope}).`,
    };
}

// ----------------------------------------------------------------------------
// Fallback: project-local .mcp.json
// ----------------------------------------------------------------------------

async function applyFallback(
    payload: Payload,
    opts: ApplyOpts,
    workspaceOf: WorkspaceResolver,
    io: FsIo,
): Promise<ApplyResult> {
    const root = workspaceOf(opts.workspace);
    const file = path.join(root, '.mcp.json');

    // Read existing config, tolerating a missing file (treat as empty object).
    let existingRaw: string | null = null;
    try {
        existingRaw = await io.readFile(file);
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
            return {
                status: 'error',
                detail: `Could not read ${file} (${code ?? 'unknown error'}). Re-run with --print and apply the snippet manually.`,
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

    const { next, status } = mergeJsonServer(parsed, SERVER_NAME, payload, opts.force);

    if (status === 'skipped') {
        return {
            status: 'skipped',
            detail: `${file} already registers "${SERVER_NAME}" (use --force to replace).`,
        };
    }

    const out = JSON.stringify(next, null, 2) + '\n';
    try {
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
 * Build the Claude Code adapter. Pass `seams` to override PATH probing, the
 * native runner, workspace resolution, or fs in tests; production uses the
 * defaults.
 */
export function createClaudeCodeAdapter(seams: ClaudeCodeSeams = {}): ClientAdapter {
    const pathProbe: PathProbe = seams.pathProbe ?? ((name) => commandOnPath(name));
    const runClaude: ClaudeRunner = seams.runClaude ?? defaultRunClaude;
    const workspaceOf: WorkspaceResolver = seams.workspaceOf ?? detectWorkspace;
    const io: FsIo = seams.io ?? defaultIo;

    return {
        id: 'claude',
        label: 'Claude Code',

        async detect(env: NodeJS.ProcessEnv): Promise<DetectResult> {
            if (await pathProbe('claude')) {
                return { present: true, via: 'path' };
            }
            const home = env.HOME ?? env.USERPROFILE;
            const configPath = home
                ? path.join(home, '.claude.json').replaceAll('\\', '/')
                : undefined;
            if (configPath) {
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
            if (await pathProbe('claude')) {
                return applyNative(payload, opts, runClaude);
            }
            return applyFallback(payload, opts, workspaceOf, io);
        },

        snippet(payload: Payload): string {
            return buildSnippet(payload);
        },
    };
}

/** Default Claude Code adapter instance, wired to the real environment. */
export const claudeCodeAdapter: ClientAdapter = createClaudeCodeAdapter();
