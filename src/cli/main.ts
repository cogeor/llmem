#!/usr/bin/env node
/**
 * LLMem CLI — argv → command dispatch
 *
 * B1 (2026-07-13): `--version`/`-V` prints the package version; an unknown
 * command exits 1 with a loud error (the old print-help-exit-0 made typos
 * look like success in scripts); command schemas are `.strict()` so a
 * typo'd flag errors naming the flag instead of being silently ignored.
 *
 * Loop 20 (phase 15): the argv parser, flag coercion, and help-text
 * formatter moved to `./arg-parser` so this entry shell stays under the
 * 250-line platform budget. `main()` keeps its identical name/signature —
 * it is bundled to `dist/cli/main.js` (the bin entry) and called by
 * `bin/llmem` + the `mcp` command path.
 */

import { serveCommand } from './commands/serve';
import { createCliContext } from './context';
import { parseArgv, coerceForSchema } from './arg-parser';
import { printHelp, printCommandHelp } from './help';
import { camelToKebab } from './schema-info';
import { CliError } from './errors';

/**
 * Dispatch argv to a command. Owns NO process termination: it returns on
 * success (including the help / unknown-command short-circuits, which print
 * and return → exit 0) and throws `CliError` on failure. `main()` is the sole
 * `process.exit` owner. arg-parser and command handlers follow the same
 * rule — neither calls `process.exit` (A-grade #2).
 */
async function runCli(): Promise<void> {
    const argv = process.argv.slice(2);

    // Global --help / -h / --version / -V short-circuits (handled before
    // dispatch). `parseArgv` throws `CliError` on an unknown short option.
    const parsedArgv = parseArgv(argv);
    const { flagMap, helpRequested, versionRequested } = parsedArgv;
    // `command` is `let` so the no-args branch can route to `serveCommand`
    // (see below). Everything else stays const.
    let command = parsedArgv.command;

    if (versionRequested) {
        // Resolved relative to the compiled entry (dist/cli/main.js) — the
        // repo/package root's package.json in both the esbuild bundle
        // (inlined at build time) and the tsc output (resolved at runtime).
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
        const pkg = require('../../package.json') as { version: string };
        console.log(pkg.version);
        return; // exit 0
    }

    if (helpRequested) {
        // `llmem <command> --help` → command-scoped help (B2); bare
        // `llmem --help` → the global page.
        if (command !== null) {
            printCommandHelp(command);
        } else {
            printHelp();
        }
        return; // exit 0
    }

    if (command === null) {
        // `llmem` / `llmem [flags]` with NO positionals: route to
        // `serveCommand` so the help-text "(default)" label is honest. The
        // Zod defaults on `serveArgs` fill in port=5757, open=true, etc.
        //
        // `llmem fnord`: an unrecognized command name is now a LOUD error
        // (exit 1). The old behavior — print help, exit 0 — made typos look
        // like success in scripts/CI. (B1: the behavior change the Loop-01
        // comment deliberately deferred.)
        const positionals = (flagMap._ as string[] | undefined) ?? [];
        if (positionals.length === 0) {
            command = serveCommand;
        } else {
            throw new CliError(
                `Unknown command '${positionals[0]}'. Run 'llmem --help' for the command list.`,
                1,
            );
        }
    }

    const coerced = coerceForSchema(command.args, flagMap);
    const parsed = command.args.safeParse(coerced);
    if (!parsed.success) {
        const lines = [`Invalid args for '${command.name}':`];
        for (const issue of parsed.error.issues) {
            // B1: schemas are `.strict()`, so a typo'd flag surfaces as an
            // `unrecognized_keys` issue — name the flag the user typed
            // (kebab-case) instead of the internal camelCase key. The `_`
            // key holds stray positionals, not a flag.
            if (issue.code === 'unrecognized_keys') {
                for (const key of issue.keys) {
                    if (key === '_') {
                        const stray = (flagMap._ as string[]).join(' ');
                        lines.push(`  unexpected argument(s): ${stray}`);
                    } else {
                        lines.push(`  unknown option --${camelToKebab(key)}`);
                    }
                }
                continue;
            }
            const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
            lines.push(`  ${path} — ${issue.message}`);
        }
        lines.push(`Run 'llmem --help' for usage.`);
        throw new CliError(lines.join('\n'), 1);
    }

    const ctx = createCliContext();
    await command.run(parsed.data, ctx);
}

export async function main(): Promise<void> {
    try {
        await runCli();
    } catch (err) {
        if (err instanceof CliError) {
            // Commands that already printed rich output throw with an empty
            // message; only print when there is something to say.
            if (err.message) console.error(err.message);
            process.exit(err.exitCode);
        }
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
    }
}

if (require.main === module) {
    void main();
}
