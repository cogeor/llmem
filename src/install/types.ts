/**
 * Shared, fs-free contract for the `llmem install` command and its per-client
 * adapters.
 *
 * This module is the pure type seam every adapter (claude / codex /
 * claude-desktop) and the install command depend on. It deliberately has NO
 * imports and NO runtime values — keeping it a types-only module means it can
 * never carry a top-level side effect and is trivially tree-shaken.
 *
 * The actual fs writes, PATH probing, and config-file merging live in
 * `registration.ts` / `detect.ts` (pure helpers) and the adapters (impure).
 */

/**
 * Identifier for a supported agent client. Stable string union — adapters key
 * off this and the command surfaces it to the user.
 */
export type ClientId = 'claude' | 'codex' | 'claude-desktop';

/**
 * The generic MCP-server registration payload, independent of any client's
 * on-disk format. Adapters translate this into their own JSON/TOML shape.
 *
 * - `command` + `args`: how to launch the llmem MCP server. Either the
 *   offline-safe global form (`llmem mcp`) or the npx fallback.
 * - `env`: extra environment variables to inject (currently only
 *   `LLMEM_WORKSPACE`, and only when a workspace is pinned).
 */
export interface Payload {
    command: string;
    args: string[];
    env?: Record<string, string>;
}

/**
 * Result of probing whether a client is installed / configured.
 *
 * - `present`: did we find any evidence of the client?
 * - `via`: how we found it — `'path'` (a binary on PATH) or `'config'`
 *   (an existing config file).
 * - `configPath`: the config file we would write to, when known.
 */
export interface DetectResult {
    present: boolean;
    via?: 'path' | 'config';
    configPath?: string;
}

/**
 * Options threaded into an adapter's `apply`.
 *
 * - `force`: overwrite an existing registration of the same name.
 * - `scope`: which config scope to target. `'user'` is the cross-machine
 *   default; `'project'` / `'local'` target the workspace.
 * - `workspace`: the pinned workspace root, when the user wants
 *   `LLMEM_WORKSPACE` baked into the registration.
 */
export interface ApplyOpts {
    force: boolean;
    scope: 'user' | 'project' | 'local';
    workspace?: string;
}

/**
 * Outcome of an adapter's `apply`.
 *
 * - `'added'`: a new registration was written.
 * - `'replaced'`: an existing registration was overwritten (force).
 * - `'skipped'`: an existing registration was left untouched (no force).
 * - `'error'`: the apply failed; `detail` carries the message.
 */
export type ApplyResult =
    | { status: 'added' | 'replaced' | 'skipped'; detail: string }
    | { status: 'error'; detail: string };

/**
 * A single client integration. Implemented once per supported client.
 *
 * The `status?` member is an intentional, currently-unimplemented seam for a
 * future `llmem uninstall` / `llmem install --status` flow (report what is
 * registered, where, and remove it). Adapters MAY leave it undefined; the
 * command must not assume it exists. Do NOT implement it yet.
 */
export interface ClientAdapter {
    id: ClientId;
    label: string;
    /** Probe whether this client is installed / configured. Pure-ish: reads
     *  only the injected `env` (and, in real adapters, the filesystem). */
    detect(env: NodeJS.ProcessEnv): Promise<DetectResult>;
    /** Write (or refuse to write) the registration. The only impure entry. */
    apply(payload: Payload, opts: ApplyOpts): Promise<ApplyResult>;
    /** Render a copy-pasteable config snippet for `--print` / manual setup. */
    snippet(payload: Payload): string;
    /**
     * FUTURE (uninstall/status hook): report the current registration state
     * for this client. Intentionally unimplemented in v1 — present only so
     * adapters and the command share a stable shape when it lands.
     */
    status?(opts: ApplyOpts): Promise<DetectResult>;
}
