/**
 * Typed CLI failure — the CLI's exit-ownership primitive.
 *
 * A-grade #2: command modules must NOT call `process.exit` themselves. Doing
 * so makes handlers impossible to compose or test in-process and scatters
 * termination across the codebase. Instead, a command (or `arg-parser`)
 * throws a `CliError`, and `main()` is the SINGLE owner of process
 * termination: it catches `CliError`, prints `message` (when non-empty) to
 * stderr, and exits with `exitCode`.
 *
 * Conventions:
 *   - `new CliError('Error: <what went wrong>')` — exit 1, message printed by
 *     `main()`. Use when the command has not already written the error.
 *   - `new CliError('', 1)` — exit 1, silent. Use when the command already
 *     printed rich (multi-line / per-item) failure output and only needs to
 *     signal a non-zero exit.
 *
 * The neutral workspace detector (`src/workspace/detect.ts`) is a lower layer
 * than the CLI, so it throws the core `WorkspaceNotFoundError` rather than a
 * `CliError`; `main()`'s generic catch turns that into `Error: <message>` /
 * exit 1.
 */
export class CliError extends Error {
    readonly exitCode: number;

    constructor(message = '', exitCode = 1) {
        super(message);
        this.name = 'CliError';
        this.exitCode = exitCode;
    }
}
