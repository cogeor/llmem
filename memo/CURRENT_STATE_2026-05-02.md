# Current State Review — 2026-05-02

A snapshot of what is wrong with the tree today, written so that the architecture memo's choices have something concrete to point at. Not a roadmap; the roadmap lives in `MIGRATION.md`.

## Symptoms

### 1. Two parallel artifact systems

`CLAUDE.md` already documents this: `src/artifact/` is "deprecated in favor of edge lists" but every MCP entrypoint still imports it (`src/info/mcp.ts:12-13`). The deprecated layer is load-bearing — `getWorkspaceRoot()` is the only resolver some call paths use. Result: every contributor has to learn which of two systems to touch.

> **Resolved by Loop 07** (`application/document-file`) and Loop 15 (`getSupportedExtensions` shim deleted). The deprecated `src/artifact/` is now load-bearing for nothing.

### 2. `src/claude/` is a kitchen sink

The folder mixes:

- the MCP stdio server (`src/claude/index.ts`)
- a long-running HTTP server (`src/claude/server/http-handler.ts`)
- a websocket bridge (`src/claude/server/websocket.ts`)
- file watchers (`src/claude/server/file-watcher.ts`, `arch-watcher.ts`)
- a static-site launcher (`src/claude/web-launcher.ts`)
- the user-facing CLI (`src/claude/cli.ts`)

These are five distinct deliverables. They share nothing meaningful at the type level; they share an owner ("the Claude integration") that has nothing to do with how the code should be organized.

> **Partially resolved by Loop 11** (HTTP routes split out into `src/claude/server/routes/`). Full sub-folder split deferred to a future loop; the boundary tests (Phase 0) prevent further mixing.

### 3. `src/webview/` mixes runtime targets

`src/webview/generator.ts`, `src/webview/design-docs.ts`, `src/webview/data-service.ts` run in **Node** and emit HTML. `src/webview/ui/**` is the **browser bundle**. Same folder, different `tsconfig`, different module systems, no shared types. The browser code accidentally imports a Node helper and the build silently breaks the runtime image — exactly the deployment-artifact-integrity failure mode flagged in the aipr manifesto.

> **Resolved by Loops 12-14** (browser-only tsconfig, sanitize/escape utilities, typed DataProvider).

### 4. `src/mcp/tools.ts` is a god module (560 lines)

It mixes Zod schemas, MCP handlers, tool registration, workspace-root assertion, and direct imports from the VS Code extension layer (`src/mcp/tools.ts:31` imports `'../extension/config'`). The MCP server therefore depends on the VS Code extension, which inverts the dependency direction we want.

> **Resolved by Loop 10** (split into per-tool files under `src/mcp/tools/`).

### 5. Workspace-root resolution duplicated in four places

- `src/claude/cli.ts::detectWorkspace` — walks up looking for `.git`, `package.json`, etc.
- `src/extension/extension.ts::startMcpServer` — reads `vscode.workspace.workspaceFolders[0]`
- `src/mcp/server.ts::getStoredWorkspaceRoot` — server-side singleton
- `LLMEM_WORKSPACE` env var consumed in several modules

There is no canonical resolver. The README's "Known Issues" section ("`report_file_info` saves to wrong path") is a direct symptom: `report_*` writes via one resolver, the user expects another, and there is no architectural place that owns the bridge.

> **Partially resolved by Loop 04** (`src/workspace/safe-fs.ts`) and Loop 07 (every entry to `application/document-file` takes a branded `WorkspaceRoot`). Multiple resolvers still exist for the bootstrap path; that is a follow-up.

### 6. Three tsconfigs, no shared core

`tsconfig.vscode.json` excludes `src/claude`, `tsconfig.claude.json` excludes `src/extension`. There is no third config for "the parts both need" — instead, the parser, graph, info, and parser packages are silently included in **both** outputs. A change in `src/parser/ts-service.ts` is built into two different `dist/` trees.

> **Partially resolved by Loops 03-04** (introduction of `src/core/`, `src/workspace/`, `src/docs/`). Splitting `src/parser/` and `src/graph/` into a shared third tsconfig is deferred.

### 7. Tests scattered

- Colocated `*.test.ts` (`src/graph/edgelist.test.ts`, `src/parser/parser-integration.test.ts`)
- Standalone scripts named `verify_*.ts` and `test_*.ts` in `src/test/` (not actually run by `npm test`)
- A separate `tests/` folder at the repo root, mostly empty
- `npm test` runs `node --test dist/**/*.test.js` — depends on a prior build, doesn't run TypeScript directly

> **Resolved by Loop 17.** All tests live under `tests/{unit,integration,arch,contracts}/`. No colocated tests in `src/`. `src/test/` and root `test/` are gone. `test:unit` runs ts-node against `tests/unit/**/*.test.ts` and `tests/contracts/*.test.ts`; `test:arch` and `test:integration` use the same harness.

### 8. Build outputs in source

`src/parser/ts-extractor.d.ts`, `src/parser/ts-service.d.ts`, `src/parser/types.d.ts`, `src/scripts/generate-call-edges.d.ts`, `src/webview/design-docs.d.ts`, `src/webview/generator.d.ts`, `src/webview/utils/md-converter.d.ts`, `src/webview/worktree.d.ts` are all checked-in `.d.ts` files alongside their `.ts` source. These are build artifacts.

> **Resolved by Loop 02.**

### 9. Repo-root cruft

`design.txt`, `memo.txt` (note the prefixes — predecessors to this `memo/` folder), `test-ws.js` (an ad-hoc websocket test), `llmem-0.1.0.vsix` (a built extension) are all committed at the repository root.

> **Resolved by Loop 02.**

### 10. `llmem-plugin/` shadows `src/claude/`

The `llmem-plugin/` directory is a Claude-Code-plugin distribution format with its own `dist/cli.bundle.js` and `.mcp.json`. It duplicates the purpose of `src/claude/` and `bin/llmem` without a clear story for which is canonical.

> **Out of scope** for the static-review-excellence stream.

## Pattern across all of these

The codebase is organized by **who built it / when** rather than by **what layer it belongs to**. `extension/` exists because someone built the VS Code extension; `claude/` exists because someone added Claude Code support; `webview/` exists because someone built the UI. There is no `domain/`, no `application/`, no shared `core/`. Adding any feature that crosses the existing folders (e.g. spec-to-code mapping, which touches docs + graph + MCP) requires reading the existing tree top-to-bottom to find a home.

The architecture memo proposes to fix that by introducing layer-shaped folders and treating the existing folders as **distribution-specific entrypoints** that compose those layers.

> **Loops 01-17 of the static-review-excellence stream resolved the boundary, contract, browser-purity, parser-truth, and test-consolidation problems. Symptoms 5, 6, and 10 remain partially or fully open and are scheduled for follow-up loops.**
