# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Nothing yet.

## [0.3.0] - 2026-06-29

The architecture-analysis release: LLMem now reports on code structure, not just
draws it.

### Added
- **`llmem health`** — codebase health report over the import + call graphs:
  - Import dependency cycles via an iterative Tarjan SCC engine (barrel/`index.ts`
    re-export exclusion), split into **runtime vs type-only** so `import type`
    cycles don't read as real ones.
  - Call-graph cycles + a mutual/self recursion bucket.
  - Hub / instability metrics (Martin `I`) with kernel vs unstable-hub labels.
  - **Interface width** analyzer (Ousterhout deep-module): per-module distinct
    external entry points, effective-width, depth, and shallow-wide flagging.
  - **Clone / duplication** detection — Tier-1 exact-body clones + Tier-1.5
    shared-literal payloads (connascence of meaning), persisted as a clone edge list.
  - Deterministic `--json` health vector and a `--fail-on <kind>` CI gate
    (`npm run health:ci`).
- **`llmem review`** + the **`review` / `report_review`** MCP tool pair — an
  LLM-driven, 65-item architecture-review checklist (34 general + 31 frontend).
  Graph/AST recall surfaces candidates; the agent judges; a hard completeness gate
  ensures every item is resolved before a report is written.
- **`llmem find-cycles`** — standalone import-cycle report with hop paths.
- **`llmem install`** — registers the MCP server with Claude Code, Codex, and
  Claude Desktop (`--dry-run` / `--print` / per-client targeting).
- Webview **health overlay** — clone edges, hub/clone smell badges, and
  import/call-cycle edges painted red (selection-immune).
- Parser: `typeOnly` import edges threaded end-to-end (schema v4); Python heuristic
  call edges.

### Changed
- Scan emits internal-only import edges by default (external deps skipped unless
  `--external`); `.delegate` work-artifact trees excluded from the graph.
- Edge freshness unified onto a sha256 content hash.
- Default `artifactRoot` is `.llmem/graph`.

## [0.2.0] - 2026-05-24

### Added
- **CLI-first surface** — `llmem serve` (zero-config: auto-scan, regenerate,
  open browser, auto-port-fallback), plus `scan`, `describe [--json]`, `document`,
  and `init` subcommands; no-args defaults to `serve`.
- **`WorkspaceIO`** with realpath containment + branded path helpers
  (`toAbs`/`toRel`/`assertContained`) for safe in-workspace file I/O.
- Folder-structure views — `FolderTreeStore` + `FolderEdgelistStore` domain
  primitives, `/api/folder-tree` + `/api/folder-edges` routes, and a Folders tab /
  `PackageView` in the webview (folder cards, arcs, drill-down).
- Unified static + VS Code webview shell (`renderShell`) with content-hash cache
  invalidation; description panel + tri-state design/graph toggle; empty-graph overlay.
- TypeScript import resolution via `ts.resolveModuleName`; edge-list schema v2 with
  `resolverVersion` + auto-rescan on mismatch.
- Shared HTTP route middleware (method/origin/token/JSON-body); `WorkspaceContext`
  + `RuntimeConfig`.

## [0.1.0] - 2025-01-01

### Added
- Initial release
- MCP server extension for VS Code
- Interactive graph visualization of import and call dependencies
- Shadow filesystem (`.arch/`) for AI-generated documentation
- Two-phase documentation workflow via MCP tools (`file_info`, `report_file_info`, `folder_info`, `report_folder_info`)
- TypeScript/JavaScript analysis via TypeScript Compiler API
- Multi-language support via Tree-sitter (Python, C/C++, Rust, R)
- Edge list-based graph storage in JSON format
- Webview panel for dependency graph visualization
- `inspect_source` MCP tool for reading source file ranges
- `open_window` MCP tool for opening the webview panel

[Unreleased]: https://github.com/cogeor/llmem/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/cogeor/llmem/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/cogeor/llmem/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/cogeor/llmem/releases/tag/v0.1.0
