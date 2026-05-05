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
    createWorkspaceContext,
    type RuntimeConfig,
    type WorkspaceContext,
} from '../../application/workspace-context';
import type { Logger } from '../../core/logger';

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
     * `configOverrides` flows through to `createWorkspaceContext` (e.g.
     * to set a non-default `artifactRoot`). The returned context's
     * `logger` bridges the CLI `log` / `error` hooks.
     */
    createWorkspace: (
        workspaceRoot: string,
        configOverrides?: Partial<RuntimeConfig>,
    ) => Promise<WorkspaceContext>;
}

export function createCliContext(): CliContext {
    // eslint-disable-next-line no-console
    const log = (msg: string) => console.log(msg);
    // eslint-disable-next-line no-console
    const error = (msg: string) => console.error(msg);

    // Bridge CLI hooks to the application `Logger` shape. info/warn route
    // through `log`; error routes through `error`. Application services
    // call `logger.info(...)` for progress.
    const cliLogger: Logger = {
        info: (m) => log(m),
        warn: (m) => log(m),
        error: (m) => error(m),
    };

    return {
        cwd: process.cwd(),
        env: process.env,
        log,
        error,
        createWorkspace: (workspaceRoot, configOverrides) =>
            createWorkspaceContext({
                workspaceRoot,
                configOverrides,
                logger: cliLogger,
            }),
    };
}
