# LLMem Architecture

Date: 2026-05-02
Status: proposed (post-review). Replace this header with "active baseline" when the migration in `MIGRATION.md` is far enough along that the structure below is what the tree actually looks like.

## Purpose

This memo defines the architecture LLMem should evolve toward. It is concrete enough that boundary tests can enforce most of it, and prescriptive enough that "where does this new module go?" has one obvious answer.

## System shape

LLMem has more than one runtime today and will have more than one product surface tomorrow:

- **MCP stdio server** — invoked by Claude Code / Claude Desktop / Antigravity / VS Code agent.
- **Local HTTP server + browser bundle** — the live-reloading webview.
- **VS Code / Antigravity extension** — embedded panel.
- **CLI** — `llmem ...` for humans.
- **Future: hosted platform** (see `design/04_platform.md`) — accepts a git URL, indexes the repo, serves an artifact bundle the open-source viewer can render.
- **Future: Claude Skills** (see `design/05_claude_integration.md`) — agents drive LLMem without running it themselves.

Today the same folders try to be all of those at once. The proposed architecture pushes the cross-cutting work into layered packages, and keeps each runtime as a thin entrypoint that wires those layers together.

## Architectural priorities

In rough order of importance:

1. Correctness of the graph and the `.arch/` shadow filesystem under concurrent edits and watch loops.
2. One canonical workspace-root resolver, threaded through every entrypoint.
3. Browser code and Node code in separately compiled units with no accidental crossover.
4. Language parsers behind a stable interface so a new language is one folder, not five.
5. The MCP layer, the HTTP server, and the VS Code extension all sit on the same domain — none is privileged.
6. A platform-shaped seam: business logic should not care whether it is running locally against a workspace or remotely against an indexed repo bundle.

## Top-level layout (proposed)

```
llmem/
├── apps/                          # thin entrypoints, distribution-specific
│   ├── cli/                       # `llmem` standalone CLI (today: src/claude/cli.ts + bin/llmem)
│   ├── mcp-server/                # MCP stdio server (today: src/claude/index.ts + src/mcp/server.ts)
│   ├── http-server/               # webview HTTP server (today: src/claude/server/*)
│   ├── vscode-extension/          # IDE extension (today: src/extension/*)
│   └── web-viewer/                # browser bundle (today: src/webview/ui/*) — separate tsconfig (DOM target)
├── packages/
│   ├── core/                      # zero-dep types, error classes, ID helpers, path utilities, logger
│   ├── domain/                    # graph concepts: nodes, edges, modules, file refs — no I/O
│   ├── application/               # use-case orchestration: scan, watch, document, query, spec-link
│   ├── parsers/
│   │   ├── shared/                # adapter interface, registry, line counter
│   │   ├── typescript/            # only language with full call graph (compiler API)
│   │   ├── python/
│   │   ├── cpp/
│   │   ├── rust/
│   │   └── r/
│   ├── graph-store/               # EdgeList persistence (was src/graph/edgelist.ts)
│   ├── docs/                      # .arch/ shadow FS, spec→file index (see design/03)
│   ├── platform-fs/               # filesystem reader, watcher, workspace-root resolver
│   ├── platform-mcp/              # MCP tool definitions, schemas, handlers
│   ├── platform-http/             # HTTP server primitives, websocket bridge
│   └── viewer-shared/             # types/contracts shared between http-server and web-viewer
├── memo/                          # this folder
├── tests/
│   ├── unit/                      # mirrors packages/
│   ├── integration/               # cross-package behavior
│   └── arch/                      # boundary/dependency-direction tests
├── tools/                         # build helpers, dev scripts, install-hooks
├── infra/                         # future platform: docker, deploy specs, worker images
├── docs/                          # user-facing docs (CHANGELOG, README, CONTRIBUTING)
└── package.json                   # workspace root (npm/pnpm workspaces)
```

The `apps/*` folders are intentionally tiny. Each contains an entry file, a thin wiring module, and tests for its specific edge cases. Everything else is in `packages/`.

## Layer responsibilities

### `core`

Zero dependencies. The reflexive layer. Where types live that everyone needs and no one should fork.

Allowed:
- `WorkspaceRoot` branded type and resolver primitives
- `RelPath` / `AbsPath` branded types
- structured error classes (`LLMemError`, `WorkspaceNotFoundError`, etc.)
- structured logger
- async-fs primitives wrapped to throw typed errors

Forbidden:
- importing from any other package
- knowing about MCP, HTTP, VS Code, or browsers

### `domain`

Pure model of "what a code graph is" — nodes, edges, modules, file refs, kinds, identities. No I/O. No filesystem.

Allowed:
- `FileNode`, `EntityNode`, `ImportEdge`, `CallEdge` types
- pure operations: `mergeEdges`, `removeNode`, `subgraphForFolder`, `reverseIndex`
- folder-tree primitives (see design/02)

Forbidden:
- depending on `application`, any `platform-*`, or any parser
- importing `fs`, `chokidar`, MCP SDK, VS Code, etc.

### `application`

Use-case orchestration. The verbs of the product.

- `scanWorkspace(workspaceRoot, options)` — walks fs, dispatches to parsers, populates `graph-store`
- `watchWorkspace(workspaceRoot)` — incremental re-scan on change
- `documentFile(workspaceRoot, relPath)` — produces the LLM enrichment prompt; consumed by both MCP and CLI
- `documentFolder(workspaceRoot, relPath)` — same for folders
- `linkSpec(workspaceRoot, specPath)` — see design/03
- `getViewerData(workspaceRoot, query)` — assembles the JSON the viewer renders

Allowed:
- depending on `domain`, `parsers/*`, `graph-store`, `docs`, `platform-fs`
- being the only place where multi-step "scan + parse + write" workflows live

Forbidden:
- importing MCP SDK, HTTP server, VS Code, browser code
- importing `apps/*`

### `parsers/*`

Each language is a self-contained package with one public surface (`createExtractor()`) declared in `parsers/shared`. Adding a language is one folder.

Allowed:
- the language's own grammar / native dep
- `core` types

Forbidden:
- importing `application` or any other parser

### `graph-store`

Pure persistence for `import-edgelist.json` and `call-edgelist.json`. Today's `src/graph/edgelist.ts` lives here, minus the bits that know about MCP responses.

### `docs`

The `.arch/` shadow filesystem and the spec→file index from design/03. Owns one canonical answer to "where does the doc for `X` live?". Today's path-mapper, storage, and tree primitives consolidate here. The deprecated `src/artifact/index.ts` is deleted.

### `platform-fs`

The single owner of:
- workspace-root detection (CLI args → `LLMEM_WORKSPACE` → walk up looking for markers → cwd)
- file watcher abstraction wrapping `chokidar`
- absolute/relative path conversion against a workspace root

This is the layer that fixes the README's "Known Issue" — `report_file_info` writes through `platform-fs.writeInWorkspace(root, relPath, contents)` and there is exactly one definition of `root`.

### `platform-mcp`

The MCP SDK boundary. Tool schemas, request validation, response formatting. Consumes `application/*` for the actual work. Schemas are defined here, not in `application` — `application` should be invokable from CLI/HTTP/MCP without each caller knowing Zod.

### `platform-http`

The HTTP server primitives, the websocket bridge, the static-asset serving. Consumes `application/*` and `viewer-shared` types.

### `viewer-shared`

The contract between the HTTP server and the browser bundle. Pure types + Zod runtime validation at the boundary, mirroring aipr's "validate every frontend API response at the module boundary" rule.

## Dependency rules

### Allowed

- `apps/*` → any `packages/*`
- `apps/web-viewer` → `viewer-shared` (and only `viewer-shared`)
- `application` → `domain`, `parsers/*`, `graph-store`, `docs`, `platform-fs`
- `platform-mcp` / `platform-http` → `application`, `domain`, `viewer-shared`, `core`
- `parsers/*` → `core`, `domain`
- `domain` → `core`
- `graph-store` → `core`, `domain`
- `docs` → `core`, `domain`, `platform-fs`

### Forbidden

- `domain` → anything except `core`
- `application` → `platform-mcp`, `platform-http`, `apps/*`
- `parsers/*` → `application`, `platform-*`, other parsers
- `apps/web-viewer` → anything Node-only
- any package → `apps/*`

These are testable. `tests/arch/` enforces them via a static import scan.

## One canonical workspace root

Every entrypoint resolves the workspace root through `platform-fs.resolveWorkspaceRoot(opts)`. There is exactly one resolver. Priority order:

1. Explicit `--workspace` CLI arg or `workspaceRoot` field on a request payload
2. VS Code extension context (when running inside the IDE)
3. `LLMEM_WORKSPACE` env var
4. Auto-detect by walking up from cwd, looking for `.llmem`, `.arch`, `.artifacts`, `.git`, `package.json`
5. `process.cwd()`

Every write path takes a `WorkspaceRoot` (branded type from `core`), not a string. This is what makes the report_*-saves-to-wrong-path bug syntactically impossible — there is no `string` overload.

## Build and packaging

Two `tsconfig` lineages, derived from one base:

- `tsconfig.node.json` — CommonJS, target ES2022, used by everything in `apps/{cli,mcp-server,http-server,vscode-extension}` and every `packages/*` except the viewer.
- `tsconfig.browser.json` — ES module, DOM lib, used by `apps/web-viewer` and `packages/viewer-shared` (when consumed from the browser).

`packages/viewer-shared` is the only package built into both — it is **types-only or zero-dep runtime helpers**. A boundary test enforces that.

The current three-tsconfig hairball collapses: `tsconfig.production.json` becomes `tsconfig.node.json` with `sourceMap: false`. `tsconfig.claude.json` and `tsconfig.vscode.json` are deleted; an `app`-level config in each `apps/*` folder extends one of the two base configs and sets `outDir`.

The `npm` workspace setup means a change in `packages/parsers/typescript` rebuilds anything that imports it, automatically, and only that.

## Testing layout

```
tests/
├── unit/               # mirror of packages/, e.g. tests/unit/graph-store/edgelist.test.ts
├── integration/        # multi-package: tests/integration/scan-then-document.test.ts
└── arch/               # boundary tests
    ├── dependencies.test.ts        # parses all imports, asserts the dependency rules above
    ├── workspace-root.test.ts      # asserts every fs write goes through platform-fs
    ├── browser-purity.test.ts      # asserts apps/web-viewer never imports Node modules
    └── tsconfig-shape.test.ts      # asserts only one base config per lineage
```

`npm test` runs all three. The `verify_*.ts` and `test_*.ts` scripts in `src/test/` are either promoted to real tests under `tests/` or deleted.

## File-size policy

Same rule as aipr: **if a file becomes a place where multiple unrelated changes accumulate, split it.** Concrete budgets to enforce in `tests/arch/`:

- no file in `apps/*` over 300 lines (entrypoints stay thin)
- no file in `application/*` over 400 lines (a workflow that big is two workflows)
- no file in `platform-mcp/tools/*` over 200 lines (one tool per file)
- the current `src/mcp/tools.ts` (560 lines) splits into one file per tool plus a `register.ts` that wires them.

## Anti-patterns

Smells we should fail loudly on:

- a workflow lives in an `apps/*` entry file instead of `application`
- a parser imports another parser
- the MCP layer reads `getConfig()` from the VS Code extension (today's `src/mcp/tools.ts:31` smell)
- two artifact systems coexist
- `.d.ts` files committed alongside `.ts` source
- a top-level `*.txt` or `*.vsix` (built artifacts in version control)
- the browser bundle reaches for `fs`, `path`, or any `node:*` module
- a watch loop owns its own workspace-root detection

## Cleanup checklist (one-pass cruft removal)

Independent of the structural migration, these are pure deletions:

- delete `design.txt`, `memo.txt`, `test-ws.js` from the repo root (superseded by `memo/`).
- delete the committed `llmem-0.1.0.vsix` (built artifact; should be in releases, not git).
- delete every `.d.ts` next to a `.ts` in `src/` (build outputs).
- delete `src/artifact/index.ts`'s deprecated bits after consolidating into `packages/docs`.
- decide whether `llmem-plugin/` is canonical or `src/claude/` is, and delete the loser. (Recommendation: `apps/mcp-server` becomes the canonical entry; `llmem-plugin/` is regenerated by a build step into `dist/plugin/` from that single source.)
- consolidate `src/test/` and `tests/` into one `tests/` folder.

## Migration

See `MIGRATION.md` for the file-by-file mechanics. The order matters — `core` and `domain` first, then the parser split, then the platform layers, finally the apps. The middle steps are designed so the build is green at every commit.

## Final rule

The architecture should be understandable by reading the folder names and import directions. When the implementation and the architecture disagree, fix the implementation or update this memo in the same PR.
