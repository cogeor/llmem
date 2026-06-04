// tests/unit/claude/cli-main-no-args.test.ts
//
// Loop 04 (code-polish) — pin the new no-args contract on `main()`:
// running `llmem` with no arguments dispatches to `serveCommand` with the
// Zod schema defaults instead of printing help and exiting 1. Sister to
// the integration smoke test in `tests/integration/cli/cli-shim-smoke.ts`,
// which now only exercises the `--help` path (the old "no args exits 1"
// assertion was removed in the same loop).
//
// The test monkey-patches `serveCommand.run` to a spy so `main()` never
// actually binds a port. That keeps it under `tests/unit/` (no I/O, no
// child process). Other state we save/restore in a `finally` block:
//   - `process.argv` (we shrink it to "no extra args")
//   - `serveCommand.run` (we swap in a spy)
// Restoring both prevents cross-test contamination — `node --test` runs
// every file in this directory in the same process.

import test from 'node:test';
import assert from 'node:assert/strict';

import { main } from '../../../src/cli/main';
import { serveCommand } from '../../../src/cli/commands/serve';

test('main(): no-args dispatches to serveCommand with schema defaults', async () => {
    const originalArgv = process.argv;
    const originalRun = serveCommand.run;

    // Spy records every (args, ctx) call so we can assert on the args
    // shape after `main()` returns. Resolves immediately so the spy does
    // not bind a port or start a server.
    const calls: Array<{ args: unknown }> = [];
    serveCommand.run = async (args) => {
        calls.push({ args });
        return;
    };

    try {
        // `main()` reads `process.argv.slice(2)`, so argv[0] and argv[1]
        // are ignored. Setting argv[1] to a sentinel keeps the shape
        // realistic without leaking any actual flags into parsing.
        process.argv = [originalArgv[0] ?? 'node', 'llmem-test'];

        await main();

        assert.equal(calls.length, 1, `serveCommand.run should be called exactly once; got ${calls.length}`);
        assert.deepEqual(
            calls[0].args,
            {
                port: 5757,
                regenerate: false,
                open: true,
                verbose: false,
            },
            'serveCommand.run should receive the Zod schema defaults (workspace omitted)',
        );
    } finally {
        process.argv = originalArgv;
        serveCommand.run = originalRun;
    }
});
