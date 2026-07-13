# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LLMem analyzes **code structure**: it builds an import dependency graph (file → file) and a
call graph (function → function) for a codebase, then surfaces that structure four ways —
an interactive web viewer, a `health` analysis report (cycles, hubs, interface width,
clones), an LLM-driven 65-item architecture **review** checklist, and per-folder/file spec
docs. It ships as one package (`@cogeor/llmem`) with three faces:

- **CLI** (`llmem`) — `dist/cli/main.js`, exposed via `bin/llmem`.
- **MCP server** (`llmem mcp`) — `dist/mcp/main.js` (the package `exports` entry); lets
  Claude Code / Codex / Antigravity call the analysis as in-band tools.
- **VS Code / Antigravity extension** — `dist/extension/extension.js` (the package `main`).

**Operating model (important):** most analysis follows **graph-recall → LLM-filter → human**.
The graph/AST produces a high-recall *candidate* set (deliberately noisy); an LLM reads the
code and decides. The product is *graph + skill + agent*, not the graph alone. Positioning is
**triage, not audit** — import edges rank hubs / map layers / find cycles, but are blind to
duplication and in-file cohesion by construction (those need the content/AST and LLM passes).

### Artifact locations

| Path | Contents |
|---|---|
| `.llmem/graph/` | Edge lists (`import-edgelist.json`, `call-edgelist.json`, `clone-edgelist.json`), `folder-tree.json`, `folder-edgelist.json`, generated webview. This is `artifactRoot` (override: `LLMEM_ARTIFACT_ROOT`). |
| `.llmem/` (root) | `health-report.{md,json}` (host artifacts CI diffs). |
| `.llmem/review/` | Review reports (`<path>.{md,json}`). |
| `.llmem/docs/` | LLM-enriched per-folder/file spec docs (markdown shadow tree). |

> Naming caveat: "artifact" is overloaded. The old `.arch/`-store artifact system is gone
> (only `src/application/migrate-docs.ts` remains, a one-time `.arch/` → `.llmem/docs/` move).
> Today "artifact" mostly means the **parser output type** (`FileArtifact`,
> `artifact-converter.ts`), not a storage system.

## Development Commands

### Build & package
```bash
npm run build              # compile (vscode + webview types) + build webview
npm run build:all          # compile:all + build webview
npm run compile            # TypeScript compile only
npm run watch              # TS watch mode
npm run package            # vsce package (VSIX)
```

### Test & lint
```bash
npm test                   # test:unit && test:arch && test:integration (node --test runner)
npm run test:unit          # tests/unit + tests/contracts
npm run test:arch          # tests/arch — architecture fitness functions (see below)
npm run test:integration   # tests/integration (concurrency 1)
npm run lint               # ESLint
npm run check:langs        # assert README lang table <-> LANGUAGES descriptor <-> peerDeps
```
The test runner is `scripts/run-tests.cjs` and **exits non-zero on failure** — `npm test`
propagates it, so CI catches red tests. (`pretest` compiles + builds webview + entrypoints.)

### Dev / debugging scripts
```bash
npm run scan               # node bin/llmem scan — build edge lists
npm run serve              # build entrypoints + webview, then llmem serve
npm run serve:dev          # ts-node src/cli/main.ts serve (no build)
npm run view               # generate static webview
npm run graph / graph:stats# llmem scan / health
npm run health:ci          # llmem health --fail-on import-cycle (CI gate convenience)
npm run file-info[:sig|:semantic]   # file-info CLI for debugging the MCP extractor
```
Press `F5` in VS Code to launch the Extension Development Host.

## Architecture

Layered, with boundaries **enforced by `tests/arch/`** fitness functions (not just convention):
`core → contracts → application → {cli, mcp, extension, http-server, webview}`. Lower layers
never import higher ones; the layer matrix in `tests/arch/layer-matrix.test.ts` encodes the
allowed edges with phase-tagged allowlists for the few exceptions.

### `src/core/` — leaf primitives
`ids.ts` (the single owner of graph-ID construction/parsing — entity IDs are `<fileId>::<name>`;
never re-derive the `::` split elsewhere), `paths.ts`, `errors.ts`, `logger.ts` (the `Logger`
boundary type; `src/common/logger.ts` owns the `StructuredLogger` impl), `language-descriptors.ts`
(the `LANGUAGES` source of truth), `config-types.ts`.

### `src/contracts/` — typed boundary payloads
`panel-messages.ts`, `webview-payloads.ts`, `folder-edges.ts`, `folder-tree.ts` — the DTOs
crossing the extension/webview/http IPC seams.

### `src/application/` — use-cases (the coordinator layer)
One folder per use-case: `scan/`, `refresh-graph/`, `file-info/`, `document-file/`,
`document-folder/`, `viewer/`, `viewer-data/`, plus:
- **`analysis/`** — the `health` engine. `health.ts` composes six dimensions into a
  deterministic `HealthReport` + flat `HealthVector` (no aggregate grade — built for
  before/after diffs): import cycles (split **runtime vs type-only**), call cycles + recursion,
  hub/instability (Martin `I`), **interface width** (`interface-width.ts` — Ousterhout
  deep-module), **clones** (`clones.ts` exact-body + `clones-literals.ts` shared-literal),
  files-over-budget. Renders via `report-markdown.ts`. SCC engine: `src/graph/scc.ts`
  (iterative Tarjan).
- **`review/`** — the architecture-review checklist. `registry.ts` holds the frozen
  `REVIEW_REGISTRY` (34 general + 31 frontend items, each with id/category/scope/recallStrength/
  recallQuery/promptInstruction). `recall.ts` + `recall-gate.ts` wire graph candidates to items;
  `signals/` holds 7 review-time regex scanners (edge lists don't retain callee names);
  `prompts/` holds embedded general/frontend methodology; `render.ts`/`validate.ts`/`persist.ts`
  emit + completeness-gate + write the report.
- `artifact-converter.ts` lives here because it's the only layer allowed to import **both**
  `parser` and `graph` (documented in its header; enforced by the layer matrix).

### `src/mcp/` — MCP server (7 tools)
`server/lifecycle.ts` registers tools over stdio; `tools/*.ts` define them; `handlers.ts`
validates/formats. Three two-phase pairs + one standalone:
- `file_info` ↔ `report_file_info` → `.llmem/docs/{path}.md`
- `folder_info` ↔ `report_folder_info` → `.llmem/docs/{path}/README.md`
- `review` ↔ `report_review` → `.llmem/review/{path}.md` (phase-2 enforces a hard completeness
  gate — if any required checklist box is unresolved, it writes nothing and names them)
- `open_window` — returns a live `http://localhost:{port}` URL if `serve` is up, else a static
  `file://` snapshot (or opens the IDE panel).

Phase-1 tools return `prompt_ready` with `promptForHostLLM` + `callbackTool` + `callbackArgs`;
the agent runs the prompt through its own LLM and calls the phase-2 tool to persist.

### `src/cli/` — CLI
`main.ts` dispatches; `registry.ts` lists commands; `arg-parser.ts` parses (`help.ts` /
`schema-info.ts` render help). Commands: `serve` (default; zero-config — auto-scans,
regenerates webview, opens browser), `mcp`, `scan`, `health` (`--json`, `--out`,
`--fail-on <kind>`), `review [path]` (`--ruleset general|frontend|both`), `describe`
(`--json`, stable command schema), `document`, `install` (registers the MCP server with
Claude Code / Codex / Claude Desktop), plus hidden alias `find-cycles` (health's cycle
dimension). Every graph consumer auto-scans on first run via `commands/ensure-graph.ts`
(honors `LLMEM_ARTIFACT_ROOT`). `generate`/`stats`/`init` were deleted 2026-07-13 (C1/C3);
graph counts live in the health report header.

### `src/graph/` — graph storage & queries
`edge-list/` (the `*EdgeListStore` classes + `base-store.ts` atomic write/dirty-flag CRUD),
`scc.ts` (Tarjan), `query/`, `webview-data.ts`, `worktree-state.ts` (watched-files set),
`types.ts`. Edge lists persist as `{version, timestamp, nodes[], edges[]}` JSON; in-memory
with periodic save.

### `src/parser/` — multi-language extraction
`registry.ts` loads parsers per `LANGUAGES`; `ts-service.ts`/`ts-extractor/` use the TypeScript
Compiler API (semantic, TS/JS only); `python/`, `cpp/`, `rust/`, `r/` use tree-sitter.
Tree-sitter grammars are **optional peer deps** loaded lazily — a missing grammar is recorded
as `needsGrammar` with an install hint, never a crash (worst case: TS/JS only).

| Language | Import graph | Call graph |
|---|---|---|
| TS/JS | yes | **semantic** (type-aware) |
| Python | yes | **heuristic** (name-matched) |
| C/C++, Rust, R | yes | none (import-only) |

### `src/http-server/`, `src/webview/`, `src/extension/`, `src/install/`, `src/workspace/`
- `http-server/` — the `GraphServer` for `llmem serve` (websocket live-reload, file watchers).
- `webview/` — `generator.ts` (static HTML) + `ui/` (graph renderer, camera, layout, file
  explorer). The viewer toggles import-graph vs call-graph; cycle edges render **red**; a
  "Health" overlay adds clone edges + smell badges.
- `extension/` — VS Code activation, config, panel.
- `install/` — `llmem install` adapters (claude-code, codex, claude-desktop).
- `workspace/` — `safe-fs.ts` + `workspace-io.ts`: realpath-containment-checked file I/O.
  All in-workspace writes route through `WorkspaceIO`; the few top-level host-artifact writers
  (health/review report writers, install adapters) are allowlisted in
  `tests/arch/workspace-paths.test.ts`.

## Architecture fitness tests (`tests/arch/`)

These enforce the design in CI — read the offending test's banner for the fix recipe; most use
an **allowlist + stale-row** pattern (add a documented entry with phase + reason, OR fix the
code):
- `layer-matrix` — allowed inter-layer import edges.
- `file-size-budget` — per-layer line budgets (`KNOWN_OVER_BUDGET` allowlist).
- `workspace-paths` — `fs.write*` must be centralized (`WRITE_ALLOWLIST`).
- `graph-ids` — `::`/`#` graph-ID separators only via `src/core/ids.ts`.
- `console-discipline`, `logger-ownership`, `html-safety`, and more.

## Workspace root detection (priority order)

1. Stored workspace root (extension context).
2. `LLMEM_WORKSPACE` environment variable.
3. Auto-detect: walk up from cwd looking for `.llmem` / `.git` / `package.json`.
4. Fallback: current working directory.

Claude Code and Codex launch the MCP server from the project dir, so auto-detect works without
config. Set `LLMEM_WORKSPACE` for Claude Desktop (no launch dir) or to pin one project.

## Configuration (all optional)

| Setting | Default | Controls |
|---|---|---|
| `artifactRoot` | `.llmem/graph` | Where edge lists + webview live |
| `maxFileSizeKB` | `512` | Skip files larger than this when scanning |
| `maxFileLines` | `2000` | Skip files with more than this many lines |
| `maxFilesPerFolder` | `20` | **Display** cap on files a folder summary lists (NOT a scan cap) |

VS Code reads the same under the `llmem.*` namespace in `.vscode/settings.json`.
