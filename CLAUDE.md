# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LLMem is an MCP (Model Context Protocol) server extension for VS Code/Antigravity IDE that generates interactive graph visualizations and documentation for codebases. It creates a "shadow filesystem" (`.arch/`) containing AI-generated documentation alongside the source code, and provides tools for analyzing import dependencies and function call relationships.

**Core Concept**: LLMem maintains parallel data structures:
- `.arch/` directory: Contains AI-generated markdown documentation mirroring the source structure
- Edge lists: JSON files tracking import and call relationships between files and functions
- Interactive webview: Graph visualization of dependencies and calls

## Development Commands

### ⚠️ Important: Webview Cache

**CRITICAL:** When making changes to `src/webview/generator.ts` or `src/webview/design-docs.ts`, the `.artifacts/webview/` directory contains cached files that must be deleted to force regeneration. Otherwise, old cached files will be served and changes won't appear.

**To clear cache:**
```bash
rm -rf .artifacts/webview
# Then trigger regeneration by touching a watched file or restarting serve mode
touch src/webview/ui/main.ts  # Triggers auto-regeneration in serve mode
```

### Build and Package
```bash
npm run build              # Full build: compile TypeScript + build webview
npm run compile            # TypeScript compilation only
npm run watch              # Watch mode for TypeScript
npm run package            # Create VSIX package (runs build first)
```

### Testing and Linting
```bash
npm test                   # Run tests (node --test)
npm run lint               # ESLint
```

### Development Scripts
```bash
# Edge list and graph generation (for debugging/development)
npm run scan               # Generate edge list from codebase
npm run view               # Generate static webview
npm run view:graph         # Generate graph-only webview

# File/folder analysis CLI (for debugging MCP tools)
npm run file-info          # Get file info
npm run file-info:sig      # File info with signatures
npm run file-info:semantic # Semantic file info
npm run module-info        # Get folder/module info
npm run module-info:semantic # Semantic module info
```

### Running in Development
Press `F5` in VS Code to launch Extension Development Host.

## Architecture

### Extension Lifecycle (`src/extension/`)

- **extension.ts**: Entry point - activates on startup, loads config, starts MCP server
- **config.ts**: Configuration management (artifact root, file limits, etc.)
- **panel.ts**: Webview panel for graph visualization

### MCP Server (`src/mcp/`)

The MCP server exposes tools for AI agents to analyze and document code:

- **server.ts**: MCP server initialization with stdio transport
- **tools.ts**: Tool definitions and handlers
- **handlers.ts**: Request validation and response formatting

**Available MCP Tools**:
- `file_info` / `report_file_info`: Generate and save file documentation
- `folder_info` / `report_folder_info`: Generate and save folder documentation
- `inspect_source`: Read specific line ranges from files
- `open_window`: Open the LLMem webview panel

**Two-Phase Documentation Workflow**:
1. `file_info` / `folder_info`: Extract structural data, return prompt for LLM enrichment
2. `report_file_info` / `report_folder_info`: Receive LLM response, save to `.arch/`

### Graph System (`src/graph/`)

Edge list-based graph representation for tracking relationships:

- **edgelist.ts**: Core storage for import/call edges in JSON format
  - `ImportEdgeListStore`: Tracks file-to-file import relationships
  - `CallEdgeListStore`: Tracks function-to-function call relationships
  - Stored as `import-edgelist.json` and `call-edgelist.json` in artifact root
- **index.ts**: Graph building from edge list data
- **types.ts**: Graph type definitions (FileNode, EntityNode, ImportEdge, CallEdge)
- **webview-data.ts**: Prepare graph data for visualization
- **worktree-state.ts**: Track watched files for lazy edge computation

**Edge List Architecture**:
- Nodes: Represent files and code entities (functions, classes, methods)
- Edges: Represent relationships (imports between files, calls between functions)
- Storage: JSON files with `{version, timestamp, nodes[], edges[]}` structure
- Updates: In-memory operations with periodic disk persistence (dirty flag)

### Parser System (`src/parser/`)

Code analysis using TypeScript Compiler API and Tree-sitter:

- **ts-service.ts**: TypeScript/JavaScript analysis (built-in)
- **ts-extractor.ts**: Extract imports, exports, function signatures
- **registry.ts**: Parser registry for multiple languages
- **config.ts**: Extension mappings and parser configuration
- **interfaces.ts**: Common interfaces for all language parsers

**Multi-Language Support**:
- TypeScript/JavaScript: Built-in support via TypeScript Compiler API
- Python, C/C++, Rust, R: Tree-sitter parsers (import graphs only)

### Information Extraction (`src/info/`)

Generates structured information for documentation:

- **extractor.ts**: Extract file/folder structural information
- **folder.ts**: Folder-level analysis using edge list data
- **mcp.ts**: MCP-specific info extraction and prompt building
- **renderer.ts**: Format extracted info as markdown
- **reverse-index.ts**: Build reverse lookup indexes for dependencies

### Artifact Management (`src/artifact/`)

Manages the `.arch/` shadow filesystem (legacy, mostly deprecated in favor of edge lists):

- **path-mapper.ts**: Map source paths to artifact paths
- **storage.ts**: File I/O operations
- **tree.ts**: Artifact tree structure
- **index.ts**: Artifact index (deprecated - edge list is preferred)

### Webview (`src/webview/`)

Interactive graph visualization UI:

- **generator.ts**: Static HTML generation for webview
- **index.html**: Main webview template
- **ui/**: UI components (file explorer, graph canvas)
- **libs/**: Visualization libraries
- **data-service.ts**: Data loading and management
- **worktree.ts**: File watching and toggle state

## Key Data Flows

### 1. Documentation Generation (MCP Tool Flow)

```
Agent calls file_info
  → Extract file structure (imports, exports, functions)
  → Build enrichment prompt
  → Return to agent

Agent processes with LLM, calls report_file_info
  → Format as design document
  → Save to .arch/{path}.md
  → Return success
```

### 2. Graph Building (Edge List Flow)

```
User toggles file/folder to "watched"
  → Parse source files with TS Compiler/Tree-sitter
  → Extract import edges (file → file)
  → Extract call edges (function → function)
  → Add to edge lists (in-memory)
  → Periodic save to JSON
  → Update webview visualization
```

### 3. Workspace Root Detection

Priority order:
1. Stored workspace root (from extension context)
2. `LLMEM_WORKSPACE` environment variable
3. Auto-detect project root (walk up from cwd looking for `.arch`, `.artifacts`, `package.json`)
4. Fallback to current working directory

## Important Patterns

### Edge List vs Artifact System

- **Edge lists** (preferred): Fast, in-memory graph representation stored as JSON
- **Artifact system** (deprecated): File-based artifact tree with metadata index
- Current direction: Edge lists for all graph operations, artifacts only for documentation storage

### Lazy Initialization

- Extension activates immediately but doesn't scan codebase at startup
- Edge computation happens on-demand when files are "watched" in the UI
- Reduces activation time and resource usage for large codebases

### MCP Tool Workspace Root Issue

Known issue (see tools.ts:550, tools.ts:562): `report_file_info` and `report_folder_info` may save to incorrect location (Antigravity AppData) instead of user workspace. After calling these tools, manually copy the generated content to the correct `.arch/` location in the workspace.

## Configuration

Extension settings (in config.ts):
- `artifactRoot`: Default `.artifacts` (location for edge lists and webview)
- `maxFilesPerFolder`: Default 20 (limit for folder analysis)
- `maxFileSizeKB`: Default 512 (skip files larger than this)

## File Patterns

- Source files: `src/**/*.ts`
- Tests: `**/*.test.ts`
- Build output: `dist/`
- Artifacts: `.arch/`, `.artifacts/`
- Edge lists: `.artifacts/import-edgelist.json`, `.artifacts/call-edgelist.json`
- Webview output: `.artifacts/webview/`
