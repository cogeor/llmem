/**
 * Pure, fs-free registration helpers for `llmem install`.
 *
 * Three building blocks, all pure (no fs writes, no top-level side effects on
 * import, never mutate their inputs):
 *
 *   - `buildPayload`   — produce the generic launch {@link Payload}, choosing
 *                        the offline-safe global form (`llmem mcp`) when a
 *                        global binary is on PATH, else the `npx` fallback.
 *   - `mergeJsonServer`— add/replace/skip an MCP server entry in a parsed
 *                        JSON config object (deep-cloned, never mutated).
 *   - `mergeTomlServer`— same add/replace/skip contract for a TOML
 *                        `[mcp_servers.<name>]` table, via a real `smol-toml`
 *                        parse → mutate → stringify round-trip (LI-05). See
 *                        its doc for the comment/ordering fidelity trade.
 *
 * The PATH probe is injected (defaulting to the real `commandOnPath`) so the
 * unit tests can drive both the global-present and global-absent branches
 * without touching the machine's real PATH. Nothing here runs PATH detection
 * at import time.
 */

import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

import { commandOnPath } from './detect';
import type { Payload } from './types';

// ----------------------------------------------------------------------------
// buildPayload
// ----------------------------------------------------------------------------

/** Injectable PATH probe seam — resolves `true` when a global binary exists. */
export type PathProbe = (name: string) => Promise<boolean>;

/** Inputs to {@link buildPayload}. */
export interface BuildPayloadOpts {
    /** Pin `LLMEM_WORKSPACE` into the payload's env when set. */
    workspace?: string;
}

/**
 * Build the generic MCP launch payload.
 *
 * - Global `llmem` on PATH ⇒ offline-safe form `{ command: 'llmem',
 *   args: ['mcp'] }`.
 * - Otherwise ⇒ `{ command: 'npx', args: ['-y', '@cogeor/llmem', 'mcp'] }`.
 * - `env.LLMEM_WORKSPACE` is added ONLY when `workspace` is provided.
 *
 * @param opts      `{ workspace? }`.
 * @param pathProbe injectable PATH probe (defaults to real `commandOnPath`).
 */
export async function buildPayload(
    opts: BuildPayloadOpts = {},
    pathProbe: PathProbe = (name) => commandOnPath(name),
): Promise<Payload> {
    const hasGlobal = await pathProbe('llmem');

    const payload: Payload = hasGlobal
        ? { command: 'llmem', args: ['mcp'] }
        : { command: 'npx', args: ['-y', '@cogeor/llmem', 'mcp'] };

    if (opts.workspace) {
        payload.env = { LLMEM_WORKSPACE: opts.workspace };
    }

    return payload;
}

// ----------------------------------------------------------------------------
// Shared merge result type
// ----------------------------------------------------------------------------

/** Outcome of a merge: the new config plus what happened. */
export interface MergeResult<T> {
    next: T;
    status: 'added' | 'replaced' | 'skipped';
}

// ----------------------------------------------------------------------------
// mergeJsonServer
// ----------------------------------------------------------------------------

/**
 * Add / replace / skip an MCP server entry inside a parsed JSON config object.
 *
 * The entry lives under the conventional `mcpServers` map. Contract:
 *   - absent          ⇒ add    (`status: 'added'`)
 *   - present + force  ⇒ replace (`status: 'replaced'`)
 *   - present + !force ⇒ skip    (`status: 'skipped'`, input unchanged)
 *
 * DEEP-CLONES the input so the caller's parsed JSON is never mutated — a later
 * `--print` of the original object must stay pristine. Unrelated `mcpServers`
 * entries and sibling top-level keys are preserved.
 *
 * @param configObj parsed JSON config (any object; may lack `mcpServers`).
 * @param name      server name key.
 * @param payload   the {@link Payload} to write.
 * @param force     overwrite an existing entry of the same name.
 */
export function mergeJsonServer(
    configObj: unknown,
    name: string,
    payload: Payload,
    force: boolean,
): MergeResult<Record<string, unknown>> {
    // Deep clone so we never mutate the caller's object.
    const base =
        configObj && typeof configObj === 'object'
            ? (configObj as Record<string, unknown>)
            : {};
    const next = structuredClone(base) as Record<string, unknown>;

    const servers =
        next.mcpServers && typeof next.mcpServers === 'object'
            ? (next.mcpServers as Record<string, unknown>)
            : {};
    next.mcpServers = servers;

    const exists = Object.prototype.hasOwnProperty.call(servers, name);
    if (exists && !force) {
        return { next, status: 'skipped' };
    }

    const entry: Payload = { command: payload.command, args: [...payload.args] };
    if (payload.env) {
        entry.env = { ...payload.env };
    }
    servers[name] = entry;

    return { next, status: exists ? 'replaced' : 'added' };
}

// ----------------------------------------------------------------------------
// mergeTomlServer
// ----------------------------------------------------------------------------

/**
 * Add / replace / skip a `[mcp_servers.<name>]` table inside TOML source text.
 *
 * SAME add/replace/skip contract as {@link mergeJsonServer}, operating on raw
 * TOML *text* (returns the new text). Unrelated tables and keys are preserved.
 *
 * Implementation (LI-05): a real `smol-toml` parse → mutate → stringify
 * round-trip. We parse the existing source into a plain object, operate on the
 * `mcp_servers.<name>` sub-table, and re-serialize.
 *
 * FIDELITY NOTE: smol-toml round-trips the *data model* (tables, keys, values)
 * faithfully and is a correct, spec-compliant serializer, but it does NOT
 * preserve source-level cosmetics — COMMENTS are dropped and key/table
 * ORDERING follows the serializer's own scheme (declared-order for top-level
 * keys, with sub-tables emitted after their parent's scalar keys), not the
 * original byte layout. Whitespace is normalized (e.g. arrays render as
 * `[ "a", "b" ]`). This is an accepted trade for correctness: a config file
 * round-tripped through here keeps all of its *semantic* content, but a
 * comment-heavy hand-edited file will lose its comments. The `skip` path
 * (present + !force) returns the input text BYTE-FOR-BYTE unchanged, so a
 * no-op re-run never disturbs comments.
 *
 * @param tomlText raw TOML source (may be empty; whitespace-only ⇒ empty doc).
 * @param name     server name (table key under `mcp_servers`).
 * @param payload  the {@link Payload} to serialize.
 * @param force    overwrite an existing table of the same name.
 * @throws if `tomlText` is not valid TOML (callers must catch and refuse to
 *         clobber — see the codex adapter).
 */
export function mergeTomlServer(
    tomlText: string,
    name: string,
    payload: Payload,
    force: boolean,
): MergeResult<string> {
    // Parse the existing document. Empty / whitespace-only ⇒ empty doc.
    const doc =
        tomlText.trim().length > 0
            ? (parseToml(tomlText) as Record<string, unknown>)
            : {};

    const servers =
        doc.mcp_servers && typeof doc.mcp_servers === 'object'
            ? (doc.mcp_servers as Record<string, unknown>)
            : {};

    const exists = Object.prototype.hasOwnProperty.call(servers, name);

    // skip: present + !force ⇒ return the ORIGINAL text byte-for-byte (so a
    // no-op re-run never reformats the file or drops comments).
    if (exists && !force) {
        return { next: tomlText, status: 'skipped' };
    }

    // Build the server entry table (command, args, optional env).
    const entry: Record<string, unknown> = {
        command: payload.command,
        args: [...payload.args],
    };
    if (payload.env && Object.keys(payload.env).length > 0) {
        entry.env = { ...payload.env };
    }

    doc.mcp_servers = { ...servers, [name]: entry };

    const next = stringifyToml(doc);
    return { next, status: exists ? 'replaced' : 'added' };
}
