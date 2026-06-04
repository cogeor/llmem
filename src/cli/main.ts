#!/usr/bin/env node
/**
 * LLMem CLI — argv → command dispatch
 *
 * Loop 01 contract: NO user-visible behavior change. Help text matches the
 * old `printHelp` from the original CLI module verbatim. No-args still
 * prints help and exits 1.
 *
 * Loop 20 (phase 15): the argv parser, flag coercion, and help-text
 * formatter moved to `./arg-parser` so this entry shell stays under the
 * 250-line platform budget. `main()` keeps its identical name/signature —
 * it is bundled to `dist/cli/main.js` (the bin entry) and called by
 * `bin/llmem` + the `mcp` command path.
 */

import { serveCommand } from './commands/serve';
import { createCliContext } from './context';
import { parseArgv, coerceForSchema, printHelp } from './arg-parser';

export async function main(): Promise<void> {
    const argv = process.argv.slice(2);

    // Global --help / -h short-circuit (handled before dispatch).
    const parsedArgv = parseArgv(argv);
    const { flagMap, helpRequested } = parsedArgv;
    // `command` is `let` so the no-args branch can route to `serveCommand`
    // (see below). Everything else (`flagMap`, `helpRequested`) stays const.
    let command = parsedArgv.command;

    if (helpRequested) {
        printHelp();
        process.exit(0);
    }

    if (command === null) {
        // No-args path (`llmem`): route to `serveCommand` so the help-text
        // "(default)" label is honest. `flagMap` is `{}` here; the Zod
        // defaults on `serveArgs` fill in port=5757, open=true,
        // regenerate=false, verbose=false. Falls through to the standard
        // coerce → safeParse → run pipeline below.
        //
        // Unknown-command path (`llmem fnord`): preserve today's exact
        // behavior — print help and `process.exit(0)`. (See PLAN.md edge
        // case: changing the unknown-command exit code is a separate
        // behavior change, deliberately not bundled with this loop.)
        if (argv.length === 0) {
            command = serveCommand;
        } else {
            printHelp();
            process.exit(0);
        }
    }

    const coerced = coerceForSchema(command.args, flagMap);
    const parsed = command.args.safeParse(coerced);
    if (!parsed.success) {
        console.error(`Invalid args for '${command.name}':`);
        for (const issue of parsed.error.issues) {
            const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
            console.error(`  ${path} — ${issue.message}`);
        }
        process.exit(1);
    }

    const ctx = createCliContext();
    try {
        await command.run(parsed.data, ctx);
    } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
    }
}

if (require.main === module) {
    void main();
}
