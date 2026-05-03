/**
 * CLI Context — minimal shared context object passed to every command's run().
 *
 * Loop 01 keeps this intentionally small: cwd, env, and basic logging hooks.
 * Workspace detection currently lives inside individual command files
 * (lifted from the old monolithic cli.ts). When loops 03+ start sharing
 * workspace + WorkspaceIO across commands, lift those helpers up to here.
 */

export interface CliContext {
    cwd: string;
    env: NodeJS.ProcessEnv;
    log: (msg: string) => void;
    error: (msg: string) => void;
}

export function createCliContext(): CliContext {
    return {
        cwd: process.cwd(),
        env: process.env,
        // eslint-disable-next-line no-console
        log: (msg: string) => console.log(msg),
        // eslint-disable-next-line no-console
        error: (msg: string) => console.error(msg),
    };
}
