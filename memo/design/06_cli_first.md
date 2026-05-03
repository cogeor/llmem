# CLI-First

Status: design sketch.
Owners: apps/cli, apps/web-viewer. Supersedes large parts of design/05; demotes src/extension/.

## Shift

The product is a CLI. Run `llmem serve`, the browser opens, the user sees the views of their codebase. That is the intended primary path.

The Antigravity / VS Code extension is no longer the focus. It can keep working for users in that environment, but new product surface goes to the CLI + web viewer first.

Agent integration (Claude and other tools) happens by **passing the CLI spec**: agents shell out to `llmem` like a human would, using `--help` and a machine-readable command schema. No bespoke MCP server is required for the primary path; no custom Claude Skills are required.

## Why

- "Install a plugin into your IDE, configure an MCP server, copy-paste JSON into your Claude config" is too many steps. Most users bounce before they see the views.
- The CLI is universally portable — any IDE, any agent, any CI runner, any laptop. The extension only worked in one host.
- One installation surface. One source of truth for behavior. One thing to test.
- Agents are already good at calling CLIs. They are not better at consuming bespoke protocols when a CLI works.

## Shape

### Primary path

```
npx @llmem/cli serve
# → scans the cwd, starts the http server, opens the browser
```

That is the demo. If `npx @llmem/cli serve` in a fresh repo does not produce a useful view, the product has failed its top-level promise.

### Command surface (trimmed from design/05)

```
llmem serve [--port N] [--no-open] [--no-watch]    # http server, watch, open browser
llmem scan                                          # one-shot index, no server
llmem document <path>                               # generate .arch/{path}.md
llmem specs (status|lint|show|touching)             # design/03
llmem pull <bundle-url>                             # design/04: fetch a hosted bundle
llmem init                                          # optional: write .llmem/config.toml
llmem describe [--json]                             # machine-readable command schema
```

Removed from the v1 surface vs design/05:
- `llmem mcp register` — no MCP server in the primary path (the server stays available for users who want it, but is no longer the recommended integration).
- `llmem skills install` — no bespoke Claude Skills.
- `llmem watch`, `llmem open`, `llmem analyze` — folded into `serve` or dropped.

### Zero-config promise

`llmem serve` in any folder must produce something useful with no prior steps:

- No `.llmem/config.toml` required — sane defaults.
- No `llmem init` required — config is optional, not mandatory.
- No language pre-selection — auto-detect by file extension.
- Default port 3000; fall back to the next free port; log the URL clearly.
- Browser opens automatically; `--no-open` for headless / CI use.

Acceptance: in a never-touched clone of a typical OSS repo, `npx @llmem/cli serve` produces a working viewer at a printed URL within 30s.

### Views served

The same set of views available in the current product, plus the package overview from design/02:

- File-and-function-level graph (current view, unchanged).
- Package overview (design/02 revision — horizontal folder layout).
- Folder design docs (`.arch/{path}/README.md`) rendered in panels.
- Spec links (design/03) once that index exists.

## Agent integration via the CLI spec

`llmem describe --json` emits the full command tree as a structured schema (subcommands, flags, types, descriptions). This is the integration surface for Claude and any other agent.

Discovery looks like:

```
$ llmem describe --json | jq '.commands'
```

Or in a system prompt: "you can use the `llmem` CLI; run `llmem describe --json` to see what it can do, then shell out to the subcommands."

A thin Claude Skill (`claude/skills/llmem/SKILL.md`) may still ship, but its content is one paragraph: "run `llmem describe --json` first, then call subcommands." That replaces the five Skills proposed in design/05. Skills become a discoverability hint, not a workflow library.

The MCP server in `src/mcp/` stays compilable and shippable for users who want it (design/05's tool surface still works), but it is not the recommended path and not what we point new users at.

## Cross-platform & stack

**Stack decision: stay on Node + TypeScript, precompile the CLI.** The CLI ships as `dist/claude/cli/main.js` invoked by `bin/llmem`; no `ts-node` at runtime. This keeps the CLI sharing code with `src/extension/` (which has to stay Node — the VS Code extension host runs Node) and keeps npm as the only distribution surface we maintain. Bun would buy ~40ms of cold start vs Node, but the cost is forking the codebase between the CLI and the extension; the actual user-facing blocker today is the broken `bin/llmem` shim and the missing zero-config path, not startup time. Reopen the question only if `llmem describe --json` startup shows up as agent-perceived latency — `bun build --compile` can layer on later as an optional single-binary distribution channel without rewriting anything.

**Cross-platform requirements (Windows + macOS + Linux):**

- **Path output.** All paths emitted by the CLI — especially `llmem describe --json` and any `document`-related stdout — use forward slashes. We keep `path.join` for filesystem operations, but normalize to `/` at the JSON / stdout boundary. Agents on Windows should not have to know they're on Windows. Internally, `WorkspaceIO` and `realpath` already give us platform-correct absolute paths; the normalization is one helper at the edge.
- **`bin/llmem` shebang.** Keep `#!/usr/bin/env node`. npm rewrites this into a `.cmd` wrapper on Windows install automatically — no PowerShell-specific scripting in the bin file, no `.bat` shim, no per-OS branches.
- **Browser opener for `--open`.** Use the `open` npm package (or equivalent), which dispatches to `open` (macOS), `start` (Windows), and `xdg-open` (Linux) under the hood. No per-OS branches in our code; one `await open(url)` call.
- **Port fallback.** `EADDRINUSE` surfaces identically across platforms (Node normalizes). The retry loop spec'd below in `server/index.ts:start()` is portable as written; no platform-specific handling needed.
- **File watching.** Already on `chokidar`, which abstracts `ReadDirectoryChangesW` / `FSEvents` / `inotify`. No change needed — explicitly: do not replace it with `fs.watch` directly, the platform behavior diverges.
- **Spawning sub-tools (post-v1).** When design/01's Tier-2 SCIP indexers land and the CLI shells out to `scip-python` etc., use `execa` (or the existing `spawn` wrapper if added) with `shell: false` and an explicit `PATH` lookup. Do not interpolate user-supplied paths into shell strings. Not v1 work, but worth pinning the rule before the first such command lands.

Acceptance: the integration tests listed in the implementation plan run on Windows, macOS, and Linux CI runners. If a test only passes on Linux, it's the test that's wrong, not the CI matrix.

## Cross-cutting impact

- **design/05 (Claude Integration)** is largely superseded. Update on next pass: trim the CLI surface, drop `llmem mcp register` / `llmem skills install` from the install story, replace the five-Skill catalog with the one-line "use the CLI spec" approach.
- **design/04 (Platform)** unaffected upstream. Downstream, the CLI is the canonical local consumer of platform bundles via `llmem pull`. The viewer the platform serves is the same web viewer the CLI starts.
- **`src/extension/` (VS Code / Antigravity)** stays compilable but receives no new feature work. Long-term, it becomes a thin wrapper that shells out to a local `llmem serve` and embeds the resulting URL in a panel — the extension stops re-implementing product behavior.
- **design/01 / design/02 / design/03** unchanged in substance; they all surface through the same `llmem serve` viewer.

## Out of scope

- Distribution beyond npm (Homebrew, scoop, static binaries). Useful but post-v1.
- Auth-protected `serve` (sharing a URL across a network). Local-only for v1.
- A TUI mode. The web viewer is the only UI we ship.
- Migrating the existing extension users. We do not actively break them; we also do not invest in feature parity.

## Open questions

- Should `llmem serve` watch by default, or only on `--watch`? Watching is the better demo; argue for default-on with `--no-watch` to disable.
- Where does `llmem describe --json` get its data? Should be re-exported from the same arg-parser the CLI uses, so the schema is the source of truth and cannot drift from the actual subcommands.
- How do we keep `llmem describe` honest? A test that walks the registered commands and asserts every subcommand and flag appears in the schema with a description, no orphans either way.
- Do we need a "managed" flag on `serve` for IDE-host scenarios where the host wants to control the lifecycle? Probably yes, for the future thin extension wrapper. Not blocking for v1.

## Implementation plan

This section is concrete enough to act on. Repo state as of `e6f806e`.

### Current code state (load-bearing facts)

- **Two CLI entries today, only one works as a binary**:
  - `bin/llmem` (the JS shim listed in `package.json#bin`) only branches on `mcp`. Every other command (`serve`, `generate`, `stats`) is unimplemented in the shim, so a user who `npm i -g @llmem/cli && llmem serve` gets `llmem: unknown command 'serve'` and bounces. This is the headline bug.
  - `src/claude/cli.ts` is the real CLI. It compiles to `dist/claude/cli.js` and is reachable via `npm run serve` / `npm run graph` / `npm run graph:stats`. It supports `serve`, `mcp`, `generate`, `stats`. Argument parsing is hand-rolled — there is no schema, no machine-readable surface.
- **The HTTP server is good**. `src/claude/server/index.ts:GraphServer` already does watch + WebSocket live-reload + regeneration via `regenerator.ts`. On `EADDRINUSE` it logs "try a different port" and exits — not zero-config friendly, but a small targeted change. `getPort()` already returns the actual bound port (the constructor tolerates `port: 0`), so port-fallback is straightforward.
- **`commandServe` errors out without artifacts**. `src/claude/cli.ts:182-196` checks `hasEdgeLists(workspace)` and aborts with `Use the VSCode extension to toggle files/folders` or `ask Claude to analyze your codebase`. This is the exact friction design/06 names — `serve` should auto-scan instead.
- **`--open` is opt-in**. `src/claude/cli.ts:69-72` and `server/index.ts:175-177`. Default-off today; design/06 wants default-on.
- **Scan is callable**. `src/application/scan.ts:scanFolderRecursive` is the canonical scan entry, takes `WorkspaceIO` for realpath-strong containment. The hand-written `src/scripts/generate_edgelist.ts` does the same thing but only for TypeScript; that script is **not** what the CLI should call (use the application layer).
- **Documentation has a clean two-step API already**. `src/application/document-file.ts:buildDocumentFilePrompt` / `processFileInfoReport`, and `src/application/document-folder.ts:buildDocumentFolderPrompt` / `processFolderInfoReport`. The MCP tools in `src/mcp/tools/` are thin wrappers around these. The `llmem document` subcommand can wrap them too — no new pipeline.
- **No `llmem describe`**. No structured schema export. No Zod schemas on CLI args (Zod is a dep already, used heavily by MCP and edge-list schemas).
- **No `.llmem/config.toml` reader**. Config today comes from VS Code settings (extension-only) or env vars (`LLMEM_WORKSPACE`, `LLMEM_ARTIFACT_ROOT`). v1 does not introduce a TOML reader; `init` writes a stub for forward compatibility but no command reads it.
- **MCP server stays compilable**. `src/mcp/server.ts` + `src/mcp/tools/*` and the `llmem mcp` subcommand keep working. The recommended install story stops mentioning them.

### Target shape

```
bin/llmem                              # JS shim — forwards ALL args to dist/claude/cli.js
src/claude/cli/
  main.ts                              # argv → command dispatch (~150 lines)
  registry.ts                          # command registry + describe walker
  context.ts                           # CliContext (workspace, logger, io)
  commands/
    serve.ts                           # zero-config + auto-port-fallback
    scan.ts                            # one-shot index
    document.ts                        # --prompt-only / --content / --content-file
    describe.ts                        # walks registry, emits human or --json
    mcp.ts                             # delegates to src/claude/index.ts:main
    init.ts                            # writes .llmem/config.toml stub
src/claude/cli.ts                      # DELETED — split into the above
```

Each command file < 200 lines. The dispatcher knows nothing command-specific.

### Command registry shape

```ts
// src/claude/cli/registry.ts
export interface CommandSpec<A extends z.ZodTypeAny = z.ZodTypeAny> {
    name: string;
    description: string;
    aliases?: string[];
    args: A;
    /** Examples for `llmem describe` and `--help`. */
    examples?: { scenario: string; command: string }[];
    /** Hide from `--help` and `describe`; keep callable. Used for legacy. */
    hidden?: boolean;
    run(args: z.infer<A>, ctx: CliContext): Promise<void>;
}

export const REGISTRY: CommandSpec[] = [
    serveCommand,
    scanCommand,
    documentCommand,
    describeCommand,
    mcpCommand,
    initCommand,
    // hidden:
    generateCommand, // alias for `serve --no-open --no-watch` (back-compat)
    statsCommand,    // alias for an inspector subcommand of `scan` (back-compat)
];
```

Each command's `args` is a Zod object. Argument parsing in `main.ts`:

1. Take `process.argv.slice(2)`.
2. First positional that matches a registered `name` or `alias` selects the command. Default = `serve` (preserves current ergonomics).
3. Convert remaining argv to a flag map (`--port 3000` → `{ port: 3000 }`, `--no-open` → `{ open: false }`, etc.). Trivial parser (~50 lines), no external dep.
4. `command.args.safeParse(flagMap)`; on failure, print Zod issues + the command's `examples`.
5. `command.run(parsedArgs, ctx)`.

### Per-command specs

**`commands/serve.ts`**:

```ts
args: z.object({
    port: z.number().int().min(0).max(65535).default(3000),
    open: z.boolean().default(true),    // CHANGED — default-on
    watch: z.boolean().default(true),
    workspace: z.string().optional(),
    verbose: z.boolean().default(false),
})
```

Run flow:

1. `workspaceRoot = detectWorkspace(args.workspace)` (lift the helper from `src/claude/cli.ts:108-133`).
2. `if (!hasEdgeLists(workspaceRoot)) await runScanWithProgress(workspaceRoot, ctx)`. Replaces today's hard-fail. Implementation: just call `scanFolderRecursive` from `application/scan.ts` with the workspace root. Print `Indexing workspace... (first run)` and a summary line at the end.
3. `const server = new GraphServer({ workspaceRoot, port: args.port, openBrowser: args.open, verbose: args.verbose })`.
4. `await server.start()` — with port fallback (see below).
5. SIGINT handler stops the server cleanly (existing pattern).

**`commands/scan.ts`**:

```ts
args: z.object({
    workspace: z.string().optional(),
    folder: z.string().default('.'),    // workspace-relative
})
```

Wraps `application/scan.ts:scanFolderRecursive`. Prints summary: files processed / skipped / errors. After the scan succeeds, calls the design/02 aggregators if they're already implemented (`buildFolderTree` / `buildFolderEdges`); otherwise no-op. CI-friendly: exit code 0 on success, non-zero if `errors.length > 0`.

**`commands/document.ts`**:

```ts
args: z.object({
    path: z.string(),                   // positional
    promptOnly: z.boolean().default(false),
    content: z.string().optional(),
    contentFile: z.string().optional(), // path or "-" for stdin
    workspace: z.string().optional(),
})
```

Run flow:

1. Resolve `path` against the workspace; classify as file or folder via `io.stat`.
2. Build the prompt via `buildDocumentFilePrompt` or `buildDocumentFolderPrompt`.
3. If `--prompt-only`: print the prompt to stdout, exit 0.
4. If `--content` or `--content-file`: parse as the agent's report, call `processFileInfoReport` / `processFolderInfoReport`. Print the path of the written `.arch/...` file.
5. Otherwise: print `Pass --prompt-only to get the prompt, then pipe the LLM output back via --content-file -. (Direct LLM invocation is post-v1.)` and exit non-zero.

This makes `document` symmetrical with the existing two-phase MCP flow but available outside MCP.

**`commands/describe.ts`**:

```ts
args: z.object({
    json: z.boolean().default(false),
})
```

Walks `REGISTRY` (skipping `hidden`), produces:

```jsonc
// llmem describe --json
{
  "version": "<package.json version>",
  "binary": "llmem",
  "commands": [
    {
      "name": "serve",
      "description": "Start the HTTP server, watch the workspace, open the browser.",
      "args": <zodToJsonSchema(serveCommand.args)>,
      "examples": [
        { "scenario": "Open the viewer", "command": "llmem serve" },
        { "scenario": "Use port 8080 without opening the browser", "command": "llmem serve --port 8080 --no-open" }
      ]
    },
    /* ... */
  ]
}
```

Uses `zod-to-json-schema` (already a dep). Without `--json`, prints a human-readable command tree.

**`commands/mcp.ts`** — single line: `await import('../../index').then(m => m.main())`. Behavior unchanged.

**`commands/init.ts`**:

```ts
args: z.object({
    force: z.boolean().default(false),
})
```

Writes `.llmem/config.toml` with the defaults, refuses to overwrite without `--force`. Content (v1):

```toml
# .llmem/config.toml
# This file is optional. LLMem works with no config file at all.
# Generated by `llmem init`. Edit freely.

artifactRoot = ".artifacts"

[scan]
# Reserved for future use (parser tier per design/01).

[server]
defaultPort = 3000
openBrowser = true
```

No reader in v1; this exists so users can find it later when reading is added.

### Auto-port-fallback in the server

Edit `src/claude/server/index.ts:start()`. Today:

```ts
await new Promise<void>((resolve, reject) => {
    this.httpServer!.listen(this.config.port, '127.0.0.1', () => { ... });
    this.httpServer!.on('error', (error: any) => {
        if (error.code === 'EADDRINUSE') { /* logs + reject */ }
    });
});
```

Replace with a loop that retries `port + 1` up to N times before giving up:

```ts
const startPort = this.config.port;
const tried: number[] = [];
let bound = false;
for (let attempt = 0; attempt < 10 && !bound; attempt++) {
    const candidatePort = startPort + attempt;
    tried.push(candidatePort);
    try {
        await listenOnce(this.httpServer!, candidatePort, '127.0.0.1');
        this.config.port = candidatePort;
        bound = true;
    } catch (err: any) {
        if (err.code !== 'EADDRINUSE') throw err;
    }
}
if (!bound) {
    throw new Error(`All ports ${tried.join(', ')} are in use.`);
}
```

`listenOnce` is a tiny promisified helper. `getPort()` and `printServerInfo` already use the actual bound port; nothing else changes.

### `bin/llmem` rewrite

Replace the current 49-line shim with:

```js
#!/usr/bin/env node
const path = require('path');
const cliPath = path.join(__dirname, '..', 'dist', 'claude', 'cli', 'main.js');
require(cliPath).main().catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
});
```

No more command branching in the shim — the dispatcher in `cli/main.ts` owns all of it.

### `package.json` changes

- `bin.llmem` stays (`./bin/llmem`).
- `main` and `exports` unchanged.
- `scripts.serve`, `scripts.graph`, `scripts.graph:stats` become thin aliases (`node ./bin/llmem serve`, etc.) so contributors keep working but the binary is canonical.
- `compile:claude` rebuilds the new `src/claude/cli/` tree alongside everything in `src/claude/`. Verify `tsconfig.claude.json` includes the new directory.

### Implementation order

1. **`bin/llmem` rewrite + `src/claude/cli/main.ts` skeleton + registry.** Move existing `serve`/`mcp`/`generate`/`stats` bodies behind the new shape with **no behavior changes**. Goal: ship and confirm `npm run serve` and `bin/llmem serve` produce identical results.
2. **Auto-port-fallback** in `server/index.ts`. Independent change; can land before or after step 1.
3. **Default-on `--open`** in `commands/serve.ts`.
4. **Zero-config in `serve`** — replace `hasEdgeLists` hard-fail with auto-scan. This is the unblock for the npm-install demo.
5. **`commands/describe.ts`** + tests asserting every command and flag has a description and example.
6. **`commands/scan.ts`** as a first-class subcommand (currently only reachable via `npm run scan`, which calls the older `src/scripts/generate_edgelist.ts`).
7. **`commands/document.ts`** wrapping the existing application services.
8. **`commands/init.ts`** — last; lowest priority.
9. **Hide `generate` and `stats`** from `--help`/`describe` but keep them callable as aliases for one release.

### User flow (when implemented)

#### "I just installed it" (the demo path)

```
$ npm i -g @llmem/cli
$ cd ~/code/some-repo
$ llmem serve
Indexing workspace... (first run)
✓ Indexed 1,247 TypeScript files (3,892 imports, 12,431 calls) in 8.4s
LLMem Graph Server ready
Server running at http://127.0.0.1:3000
[browser opens automatically]
Press Ctrl+C to stop
```

If port 3000 is busy:

```
Server running at http://127.0.0.1:3001
```

(Silent fallback; only logged if `--verbose`.)

#### "I'm an agent integrating with this"

```
$ llmem describe --json | jq '.commands[].name'
"serve"
"scan"
"document"
"describe"
"mcp"
"init"

$ llmem document src/parser/extractor.ts --prompt-only
# FILE DOCUMENTATION TASK
## OBJECTIVE
Create a comprehensive design document for: src/parser/extractor.ts
[full prompt to stdout]

# Agent runs the prompt through its own LLM, captures output to $DOC.

$ printf '%s' "$DOC" | llmem document src/parser/extractor.ts --content-file -
✓ Wrote .arch/src/parser/extractor.ts.md (2,431 bytes)
```

The agent never speaks MCP. It shells out exactly like a human would.

#### "I want to use this in CI"

```
$ llmem scan
✓ Indexed 1,247 files. Edge lists in .artifacts/.

$ llmem describe --json > artifacts/llmem-cli-schema.json
```

#### "I want to use the existing MCP integration"

```
$ llmem mcp
[stdio MCP server starts; identical behavior to today]
```

(Available, just not pushed at new users.)

### Test strategy

- `tests/integration/cli/cli-describe.test.ts` — every command in `REGISTRY` (excluding `hidden`) appears in `llmem describe --json`; every flag has a description; the JSON validates against a meta-schema.
- `tests/integration/cli/cli-serve-zero-config.test.ts` — fresh tmp workspace with two TS files → spawn `bin/llmem serve --port 0 --no-open` → wait for stdout `Server running at` → fetch `/api/stats` and assert HTTP 200 → kill. Also assert `.artifacts/import-edgelist.json` was created.
- `tests/integration/cli/cli-port-fallback.test.ts` — bind 3000 in the test, spawn `llmem serve` (default port), assert it picks 3001.
- `tests/integration/cli/cli-document.test.ts` — `llmem document fixtures/foo.ts --prompt-only` returns the expected prompt text; `--content X` writes `X` to `.arch/fixtures/foo.ts.md`.
- `tests/contracts/cli-schema.test.ts` — the output of `llmem describe --json` is stable across releases (snapshot test on the LLMem-repo's own commands so contributors notice schema drift).
- Existing `scripts/test_extension_load.js` smoke test: keep working through the rewrite (verifies the `bin/llmem` shim still loads).

### Out of scope for v1

- `llmem pull <bundle-url>` (depends on design/04, not promoted).
- `.llmem/config.toml` reader (writer ships in v1 via `init`; reader post-v1).
- Direct LLM invocation in `document` (no key, no provider abstraction yet — `--prompt-only` and `--content` cover the agent integration story).
- Distribution beyond npm.
- `llmem update` self-update.
- The "managed" flag for IDE-host lifecycle. Reopen when `src/extension/` is rewritten as a thin wrapper around `llmem serve`.
