/**
 * Standalone bundle entry for the MCP stdio server (built to dist/mcp/main.js
 * and referenced by package.json `main`/`exports`).
 *
 * Kept separate from `main.ts` so that `main.ts` stays a PURE LIBRARY: the CLI
 * `mcp` subcommand (`src/cli/commands/mcp.ts`) imports `main` from it and calls
 * it explicitly. esbuild collapses every inlined module into a single CJS file,
 * which makes `require.main === module` evaluate true even for imported
 * modules — so a self-exec guard inside `main.ts` would double-bootstrap when
 * bundled into the CLI. This file is only ever an esbuild ENTRY (never
 * imported), so it can call `main()` unconditionally.
 */
import { main } from './main';

main().catch((error) => {
    // fatal-bootstrap: top-level main() rejection — the process is about to
    // exit non-zero regardless of logger state, so emit plainly.
    // eslint-disable-next-line no-console
    console.error('[MCP] Fatal error:', error);
    process.exit(1);
});
