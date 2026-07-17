/**
 * CLI Context — minimal shared context object passed to every command's run().
 *
 * Loop 01 keeps this intentionally small: cwd, env, and basic logging hooks.
 *
 * Loop 04 adds a `createWorkspace` helper so commands can build a single
 * `WorkspaceContext` per invocation. The helper closes over
 * `createWorkspaceContext` and routes the CLI logger hooks through to
 * the application logger interface — application services get
 * progress / error visibility via the same `console.log` / `console.error`
 * sink the CLI's user output uses.
 */

import {
    initWorkspaceContext,
    type RuntimeConfig,
    type WorkspaceContext,
} from '../application/workspace-context';
import { ENV_VARS } from '../config-defaults';
import type { Logger } from '../core/logger';
import {
    resolveArtifactRootPrecedence,
    type StoreMode,
} from '../workspace/store-location';

export interface CliContext {
    cwd: string;
    env: NodeJS.ProcessEnv;
    log: (msg: string) => void;
    error: (msg: string) => void;
    /**
     * Build a `WorkspaceContext` for the supplied workspace root.
     * Handles the realpath / `WorkspaceIO` construction once per
     * command. CLI commands typically pass `detectWorkspace(args.workspace)`
     * as the root.
     *
     * `configOverrides` flows through to `initWorkspaceContext` (e.g.
     * to set a non-default `artifactRoot`). The CLI is a host, so this
     * uses the host-startup factory (construct + one-time docs migration).
     * The returned context's `logger` bridges the CLI `log` / `error` hooks.
     */
    createWorkspace: (
        workspaceRoot: string,
        configOverrides?: Partial<RuntimeConfig>,
        opts?: {
            /**
             * `--store` flag (P1 portable store). `global` routes artifacts
             * to the per-user store keyed by the workspace path; an explicit
             * `repo` beats `LLMEM_STORE=global`. Both lose to an explicit
             * `artifactRoot` override / `LLMEM_ARTIFACT_ROOT`.
             */
            store?: StoreMode;
        },
    ) => Promise<WorkspaceContext>;
}

export function createCliContext(opts: { verbose?: boolean } = {}): CliContext {
    // eslint-disable-next-line no-console
    const log = (msg: string) => console.log(msg);
    // eslint-disable-next-line no-console
    const error = (msg: string) => console.error(msg);

    // Bridge CLI hooks to the application `Logger` shape. info/warn route
    // through `log`; error routes through `error`. Application services
    // call `logger.info(...)` for progress. `debug` (B3) is diagnostic
    // chatter ([GenerateEdges] et al.) — surfaced only under --verbose.
    const cliLogger: Logger = {
        info: (m) => log(m),
        warn: (m) => log(m),
        error: (m) => error(m),
        debug: opts.verbose ? (m) => log(m) : undefined,
    };

    return {
        cwd: process.cwd(),
        env: process.env,
        log,
        error,
        // A5 (bug 1.3): honor LLMEM_ARTIFACT_ROOT for CLI commands. The help
        // text has always documented it (and the MCP server honors it), but
        // the loose context factory only merges explicit overrides over
        // DEFAULT_CONFIG — so without this seam the env var was dead for the
        // CLI. Explicit per-command overrides still win.
        createWorkspace: (workspaceRoot, configOverrides, opts) => {
            // Drop explicit-undefined overrides so commands can thread
            // optional flags (e.g. `--artifact-root`) unconditionally
            // without clobbering the env/default fallback below.
            const overrides = Object.fromEntries(
                Object.entries(configOverrides ?? {}).filter(
                    ([, v]) => v !== undefined,
                ),
            );
            // Precedence (P1 portable store): --artifact-root flag >
            // LLMEM_ARTIFACT_ROOT > --store global / LLMEM_STORE=global >
            // default (.llmem/graph). Single owner: store-location.ts.
            const effectiveArtifactRoot = resolveArtifactRootPrecedence({
                workspaceRoot,
                flagArtifactRoot:
                    typeof overrides.artifactRoot === 'string'
                        ? overrides.artifactRoot
                        : undefined,
                envArtifactRoot: process.env[ENV_VARS.ARTIFACT_ROOT],
                flagStore: opts?.store,
                envStore: process.env[ENV_VARS.STORE],
            });
            return initWorkspaceContext({
                workspaceRoot,
                configOverrides: {
                    ...(effectiveArtifactRoot
                        ? { artifactRoot: effectiveArtifactRoot }
                        : {}),
                    ...overrides,
                },
                logger: cliLogger,
            });
        },
    };
}
