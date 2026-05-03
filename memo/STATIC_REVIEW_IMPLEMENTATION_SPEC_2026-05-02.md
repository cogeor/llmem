# Static Review Implementation Spec - 2026-05-02

Status: static review report and implementation spec.
Scope: codebase quality, module boundaries, frontend, backend, tests, architecture, and migration shape.

## Purpose

This report consolidates the static code review with the existing `memo/` architecture notes. It is not a grading document. It records:

- what the implementation looks like today
- where it overlaps or disagrees with existing memos
- a cleaner folder/module structure focused on minimizing cross-folder input/output
- an implementation spec for getting from the current tree to that structure

No tests were run for this review.

## Existing Memo Alignment

The existing memo set is mostly accurate and already names the biggest architectural drift.

### Strong Overlap

- `memo/CURRENT_STATE_2026-05-02.md` correctly identifies the deprecated `src/artifact/` system as still load-bearing through `src/info/mcp.ts`.
- `memo/CURRENT_STATE_2026-05-02.md` correctly calls out `src/claude/` as a mixed folder containing MCP stdio, HTTP serving, websocket, watchers, launcher, and CLI code.
- `memo/CURRENT_STATE_2026-05-02.md` correctly identifies `src/webview/` as mixing Node-side generator/data code and browser runtime code.
- `memo/ARCHITECTURE.md` correctly proposes thin apps plus shared packages. That direction matches the static review.
- `memo/MIGRATION.md` correctly starts with cruft removal, generated declaration cleanup, and workspace setup.
- `memo/design/02_folder_view.md` correctly treats folder view as a domain primitive, not a webview-only feature.
- `memo/design/03_spec_to_code_mapping.md` correctly places spec indexing in a docs/application layer rather than making it an MCP-only feature.

### Discrepancies Or Refinements

- `memo/ARCHITECTURE.md` proposes a fairly deep `packages/` structure. That is directionally right, but the migration should avoid creating packages before their contracts are stable. Start with modules under `src/modules/` or workspaces with narrow public `index.ts` files only where the boundaries are already clear.
- `memo/MIGRATION.md` says "No rename + edit in one commit." That is good for reviewability, but the first boundary step should also add import-boundary tests before large moves. Otherwise the tree can be moved without proving the direction is cleaner.
- `memo/ARCHITECTURE.md` places file watchers in `platform-fs`. The review suggests splitting generic filesystem/path helpers from long-running watch orchestration. Watchers have stateful application behavior and should depend on a small `workspace`/`fs-boundary` module, not be inside the lowest-level filesystem module.
- `memo/design/01_non_ts_call_graphs.md` says tree-sitter did not provide calls fast enough. The current Python extractor still contains unused call extraction/resolution methods even though extraction returns empty calls. Those methods should be removed or moved behind an experimental tier to avoid contradicting the product contract.
- `memo/design/04_platform.md` depends on a stable artifact bundle format. Today the viewer data shape is not stable enough: graph IDs, doc keys, watched paths, and folder state are still inferred by string convention in multiple places.

## Current State

### Runtime Surfaces

The repo currently contains these surfaces:

- VS Code / Antigravity extension in `src/extension/`
- MCP server in `src/mcp/` and `src/claude/index.ts`
- HTTP graph server in `src/claude/server/`
- CLI in `src/claude/cli.ts`
- static webview generator and data assembly in `src/webview/`
- browser webview UI in `src/webview/ui/`
- parser and graph implementation in `src/parser/`, `src/graph/`, `src/info/`, `src/artifact/`
- ad hoc scripts in `src/scripts/`, `scripts/`, `src/test/`, root `test/`

The product shape is coherent, but the code ownership is not. Folders mostly represent historical entrypoints, not self-contained code modules.

### Boundary Problems

- `src/mcp/tools.ts` imports `../extension/config`, so the MCP layer depends on the VS Code extension layer.
- `src/extension/panel.ts` imports `../scripts/generate-call-edges`, so the UI host calls script code directly.
- `src/scripts/*` imports extension config, so scripts are not clean command wrappers around application services.
- `src/webview/ui/*` is browser code but imports parser config from `src/parser/config.ts`.
- `src/info/mcp.ts` imports deprecated artifact service functions.
- `src/config-defaults.ts` imports the extension `Config` type, making the default config module depend on an app-specific config shape.

### Data Contract Problems

- Graph entity IDs are built as strings like `{fileId}::{entityName}` in `artifact-converter.ts`.
- Some UI code still parses graph IDs using `#`.
- Edge deletion checks exact paths, folder prefixes, `#`, and `::` conventions in different places.
- Design doc keys sometimes preserve `README.md`, sometimes convert `.md` to `.html`, and sometimes strip file extensions.
- Watched state is stored as files only, but folders are still treated as first-class toggle inputs in several host/UI paths.

These should be explicit value objects and schemas, not string conventions.

### Frontend Problems

- `Worktree` renders filesystem-derived names through HTML strings.
- `DesignRender` injects converted markdown HTML without sanitization.
- Component props often type `state` and host APIs as `any`.
- `VSCodeDataProvider` supports only one pending watch toggle request, so concurrent toggles can overwrite each other.
- The DataProvider abstraction exists, but components still peek into provider implementation details such as `getVscodeApi()` and attempted cache access through `as any`.
- The router is mostly vestigial because the layout is now three columns.

### Backend Problems

- `src/claude/server/index.ts` is an orchestration hub that owns HTTP endpoints, graph regeneration, watch state, auth, websocket broadcasting, and browser opening.
- Request bodies have no size limit in the HTTP server.
- Static serving normalizes traversal but does not enforce final resolved path containment against `webviewDir`.
- `apiToken` protects only design-doc writes, not all mutating endpoints.
- Logging is mixed between `console.log`, `console.error`, extension output channels, and ad hoc verbose flags.

### Parser And Graph Problems

- Parser registry is a good pattern, but runtime support and UI support are not the same source of truth.
- `.java` and `.go` are listed as supported in config/watch code without adapters.
- TypeScript extraction is heuristic around signatures, method calls, and local call fallback.
- Python extractor has unused call-resolution code despite the current product statement that non-TS languages do not support call graphs.
- Edge stores are simple and useful, but they lack validation/migration at load time beyond shallow shape checks.

### Build And Repo Hygiene Problems

- Generated `.js` and `.d.ts` files are committed under `src/`.
- `tsconfig.claude.json` uses `rootDir: src/claude` while Claude code imports modules outside `src/claude`.
- Root contains built or superseded files such as `llmem-0.1.0.vsix`, `design.txt`, `memo.txt`, and `test-ws.js`.
- README and HTML contain mojibake characters, suggesting encoding drift.
- `package.json` references `src/info/cli_module.ts`, but the file list did not show that file.

## Proposed Cleaner Folder Structure

The goal is not deep nesting. The goal is narrow module inputs/outputs. A folder should be understandable by its public API and should not require callers to know its internal file layout.

Recommended end-state:

```text
src/
  core/
    index.ts
    errors.ts
    logger.ts
    ids.ts
    paths.ts
    schemas.ts

  workspace/
    index.ts
    resolve-root.ts
    safe-fs.ts
    watch.ts

  graph/
    index.ts
    model.ts
    ids.ts
    build.ts
    edge-store.ts
    webview-data.ts

  parsers/
    index.ts
    contract.ts
    registry.ts
    config.ts
    typescript/
    python/
    cpp/
    rust/
    r/

  docs/
    index.ts
    arch-store.ts
    design-docs.ts
    markdown.ts
    spec-index.ts

  application/
    index.ts
    scan.ts
    watch-workspace.ts
    viewer-data.ts
    document-file.ts
    document-folder.ts
    inspect-source.ts

  protocols/
    mcp/
      index.ts
      server.ts
      responses.ts
      tools/
        file-info.ts
        folder-info.ts
        inspect-source.ts
        open-window.ts
        report-file-info.ts
        report-folder-info.ts
    http/
      index.ts
      server.ts
      static-files.ts
      websocket.ts
      routes/

  apps/
    cli/
      main.ts
      commands/
    vscode/
      extension.ts
      panel.ts
      hot-reload.ts
    web-viewer/
      main.ts
      components/
      graph/
      services/
      styles/
      index.html
```

This is intentionally shallower than the existing `memo/ARCHITECTURE.md` package proposal. It can later be split into npm workspaces once these module contracts are stable. The first priority is clean imports and ownership, not packaging.

## Module Contracts

### `core`

Inputs: none.

Outputs:

- branded path types
- graph ID constructors/parsers
- structured errors
- logger interface
- small schema helpers

Forbidden:

- `fs`, `vscode`, MCP SDK, HTTP, parser grammars, browser DOM

### `workspace`

Inputs:

- process cwd, env, explicit workspace options, host-provided workspace paths

Outputs:

- canonical `WorkspaceRoot`
- safe relative/absolute path conversions
- filesystem read/write helpers
- watcher event stream

Forbidden:

- graph generation
- MCP response formatting
- webview data assembly

### `graph`

Inputs:

- parser `FileArtifact`
- persisted edge-list JSON
- watched-file filter

Outputs:

- validated graph model
- import/call edge stores
- viewer graph DTOs

Forbidden:

- reading source files
- workspace-root detection
- UI rendering
- MCP/HTTP/VS Code imports

### `parsers`

Inputs:

- absolute source file path
- file content
- workspace root

Outputs:

- `FileArtifact`

Forbidden:

- writing edge lists
- managing watched state
- importing other parser implementations
- webview concerns

### `docs`

Inputs:

- workspace root
- source-relative file/folder path
- markdown content

Outputs:

- canonical `.arch` paths
- rendered and sanitized design docs
- spec-to-code index

Forbidden:

- MCP-specific prompt response shape
- graph scan orchestration

### `application`

Inputs:

- use-case requests from hosts: scan, document, inspect, get viewer data, toggle watch

Outputs:

- host-neutral result objects

Allowed dependencies:

- `core`, `workspace`, `graph`, `parsers`, `docs`

Forbidden:

- `vscode`
- MCP SDK
- browser DOM
- direct HTTP response handling

### `protocols/mcp`

Inputs:

- MCP request payloads

Outputs:

- MCP-compatible tool definitions and responses

Forbidden:

- parser internals
- direct `.arch` writes except through `application`
- VS Code config

### `protocols/http`

Inputs:

- HTTP requests

Outputs:

- JSON DTOs, static viewer assets, websocket events

Forbidden:

- parser internals
- direct graph generation except through `application`

### `apps/*`

Inputs:

- user/host entrypoint events

Outputs:

- wiring only

Rule:

- apps should compose modules. They should not contain product workflows.

## Implementation Spec

### Phase 0 - Freeze Current Contracts

Create tests or static checks before moving files:

- import-boundary scanner that fails on forbidden imports
- graph ID parse/build tests
- design-doc key mapping tests
- workspace path containment tests
- browser-purity scan for `apps/web-viewer` or current `src/webview/ui`

Acceptance:

- A static check can explain why `mcp -> extension`, `extension -> scripts`, and browser `ui -> parser` are forbidden.

### Phase 1 - Hygiene Cleanup

Tasks:

- remove generated `.js` and `.d.ts` files from `src/`
- add ignore rules for generated declarations and JS under `src/`
- remove root built/superseded artifacts: `llmem-0.1.0.vsix`, `design.txt`, `memo.txt`, `test-ws.js`
- fix README and HTML encoding artifacts
- remove or fix dead package scripts such as `module-info` if `src/info/cli_module.ts` does not exist

Acceptance:

- `src/` contains authored source only
- generated output is confined to `dist/`
- repo root contains source/config/docs only

### Phase 2 - Canonical Contracts

Tasks:

- add `core/ids.ts` with `makeFileId`, `makeEntityId`, `parseGraphId`, `isExternalModuleId`
- replace all `::` and `#` ad hoc parsing with these helpers
- add `docs/arch-store.ts` to own `.arch` path mapping for files and folders
- add `workspace/safe-fs.ts` to own path containment checks
- move config types out of `extension/config.ts` into `core` or `application`

Acceptance:

- no graph ID parsing by raw `split('::')`, `lastIndexOf('#')`, or prefix guessing outside the ID module
- no `.arch` path construction outside `docs`
- no app-specific config type imported by shared modules

### Phase 3 - Extract Application Services

Tasks:

- turn `src/scripts/generate-call-edges.ts` into `application/scan.ts`
- turn `WebviewDataService.collectData` into `application/viewer-data.ts`
- turn `info/mcp.ts` prompt-building into `application/document-file.ts`
- turn `info/folder.ts` prompt-building into `application/document-folder.ts`
- expose `application/toggle-watch.ts` so VS Code and HTTP use the same watch workflow

Acceptance:

- VS Code panel no longer imports scripts
- HTTP server no longer imports scripts
- MCP tools call application services only
- scripts become thin CLI wrappers or are removed

### Phase 4 - Split Host Protocols

Tasks:

- split `src/mcp/tools.ts` into one tool file per MCP tool
- remove `getConfig` import from MCP tools
- move HTTP route handlers out of `GraphServer` into route modules
- add request body size limits and validate mutating endpoints
- apply `apiToken` consistently to mutating HTTP routes, or explicitly document why watch/regenerate remain unauthenticated on localhost

Acceptance:

- `protocols/mcp` depends on `application`, not `extension`
- `protocols/http` depends on `application`, not scripts
- no protocol file exceeds roughly 250 lines except the server registrar

### Phase 5 - Browser Boundary Cleanup

Tasks:

- move browser UI under `apps/web-viewer` or at least isolate `src/webview/ui` with a browser-only tsconfig
- move Node-side webview generation/data code out of the browser folder
- replace `Worktree` HTML string rendering with DOM construction or escaped template helpers
- sanitize markdown HTML before rendering
- type the app state interface and component props; remove `state: any`
- replace `getVscodeApi()` branching in components with DataProvider capabilities
- make `VSCodeDataProvider` pending requests keyed by request ID

Acceptance:

- browser code imports only browser-safe modules and viewer-shared types
- no unsanitized markdown HTML reaches `innerHTML`
- DataProvider is the only environment abstraction visible to components

### Phase 6 - Parser And Graph Cleanup

Tasks:

- remove `.java` and `.go` from runtime-supported extension lists until adapters exist
- make ParserRegistry the runtime source of truth for support
- remove unused Python call extraction code or put it behind an explicit experimental tier
- validated edge-list JSON with a Zod schema and version migration (Loop 16); see `src/graph/edgelist-schema.ts`
- corrected lazy-mode line counting (Loop 16); previous code used `sf.getEnd()` which returned a character offset
- distinguished external-module nodes from workspace file nodes in the graph model (Loop 16); runtime discrimination via `parseGraphId` / `ExternalModuleNode`

Acceptance:

- UI watch toggles appear only for files a registered parser can process
- graph stores reject invalid persisted shape with actionable errors
- non-TS call graph behavior matches README and memo/design/01

### Phase 7 - Test Consolidation

Tasks:

- move real tests into one `tests/` layout or colocate consistently
- promote useful `src/test/verify_*` scripts into `node:test` tests
- delete ad hoc scripts that are no longer useful
- add contract tests for MCP tool schemas, HTTP route DTOs, design-doc key mapping, graph ID mapping, and workspace-root writes

Acceptance:

- `npm test` runs all committed tests
- no hidden test scripts are required to verify core behavior
- architecture tests prevent the original boundary leaks from returning

## Immediate Priority Order

1. Remove generated `src` artifacts and root built artifacts.
2. Introduce graph ID and docs path contract modules.
3. Extract application services from scripts and host code.
4. Split MCP tools and HTTP routes.
5. Sanitize/escape webview rendering.
6. Consolidate parser support lists around ParserRegistry.
7. Consolidate tests and add architecture boundary checks.

## Non-Goals For The First Refactor

- Do not implement the hosted platform yet.
- Do not implement SCIP indexing yet.
- Do not rewrite the graph layout algorithm unless boundary cleanup exposes a specific bug.
- Do not convert to many npm workspaces before the module APIs are stable.

## Definition Of Done

The refactor is successful when:

- every source folder has one clear module responsibility
- cross-folder calls go through public `index.ts` APIs or explicit use-case services
- browser code cannot import Node-only modules
- protocol layers do not know parser internals
- app layers contain wiring, not workflows
- `.arch` paths, graph IDs, workspace roots, and viewer DTOs are validated contracts
- the existing memos either match the implemented structure or are updated in the same change
