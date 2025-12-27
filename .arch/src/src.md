# LLMem Codebase Overview

LLMem is an MCP (Model Context Protocol) server that provides interactive graph visualization and AI-assisted documentation for codebases. It works with both **Claude Code** (as a CLI plugin) and **VS Code/Antigravity** (as an extension).

## Core Architecture

1. **Edge List Storage**: Import and call relationships stored as JSON edge lists in `.artifacts/`
2. **Multi-Language Parsing**: Tree-sitter for Python/C++/Rust/R, TypeScript Compiler API for TS/JS
3. **MCP Server**: Exposes tools (`file_info`, `folder_info`, `inspect_source`) for AI agents
4. **Two-Phase Documentation**: Extract structure → LLM enrichment → save to `.arch/`
5. **Graph Visualization**: Interactive webview with import and call graphs

## Source Layout (`src/`)

### `claude/` — Claude Code Integration
- `index.ts` — MCP server entry point for Claude Code
- `cli.ts` — CLI commands: `serve`, `generate`, `stats`, `mcp`
- `server.ts` — Graph server with HTTP + WebSocket
- `server/` — File watching, hot reload, WebSocket handlers

### `extension/` — VS Code/Antigravity Integration
- `extension.ts` — Extension activation and lifecycle
- `config.ts` — Configuration management
- `panel.ts` — Webview panel for graph visualization
- `hot-reload.ts` — Watch `.artifacts/` for live updates

### `mcp/` — Model Context Protocol Server
- `server.ts` — MCP SDK initialization with stdio transport
- `tools.ts` — Tool definitions: `file_info`, `folder_info`, `report_file_info`, `report_folder_info`, `inspect_source`, `open_window`
- `handlers.ts` — Request validation and response formatting
- `path-utils.ts` — Workspace path validation

### `graph/` — Edge List Storage
- `edgelist.ts` — `ImportEdgeListStore` and `CallEdgeListStore` classes
- `webview-data.ts` — Transform edge lists for visualization
- `worktree-state.ts` — Track watched files for lazy computation

### `parser/` — Code Analysis
- `registry.ts` — Language adapter registration
- `adapter.ts` — Base adapter interface
- `ts-service.ts` / `ts-extractor.ts` — TypeScript/JavaScript (full call graph)
- `python/`, `cpp/`, `rust/`, `r/` — Tree-sitter adapters (imports only)

### `info/` — Documentation Generation
- `extractor.ts` — Extract file structure (imports, exports, functions)
- `folder.ts` — Folder-level analysis
- `mcp.ts` — Build enrichment prompts for LLM
- `renderer.ts` — Format as markdown

### `webview/` — Graph Visualization UI
- `generator.ts` — Static HTML generation
- `ui/main.ts` — UI entry point
- `ui/components/` — Worktree, DesignTextView, ViewToggle
- `ui/graph/` — GraphRenderer, EdgeRenderer, NodeRenderer
- `ui/services/` — Data providers, caching, watch API

### `artifact/` — Legacy Storage (Deprecated)
- Shadow filesystem for `.arch/` documentation
- Being replaced by edge list system

### `scripts/` — Build Utilities
- `generate_edgelist.ts` — Scan codebase for edges
- `generate_webview.ts` — Build static webview
- `build_webview.ts` — Bundle webview assets

## Data Flow

### Graph Building
```
Toggle file in UI → Parse with Tree-sitter/TS Compiler
  → Extract imports/calls → Add to edge list (in-memory)
  → Periodic save to JSON → Update webview
```

### Documentation Generation
```
Agent calls file_info → Extract structure + source
  → Return enrichment prompt → LLM processes
  → Agent calls report_file_info → Save to .arch/
```

## Key Files

| Purpose | File |
|---------|------|
| Edge list storage | `graph/edgelist.ts` |
| MCP tool definitions | `mcp/tools.ts` |
| Language registry | `parser/registry.ts` |
| Webview generation | `webview/generator.ts` |
| Claude CLI | `claude/cli.ts` |
| VS Code extension | `extension/extension.ts` |
