# FOLDER: src

## Overview
The `src/` folder is the core implementation of LLMem, an MCP (Model Context Protocol) server extension for the Antigravity IDE. It provides semantic documentation generation for codebases by maintaining a shadow filesystem of artifacts—high-level summaries, code outlines, and architectural notes—that exist alongside source code.

The codebase is organized into specialized modules: MCP protocol handling, artifact management, code parsing with Tree-sitter, graph-based dependency tracking, and an interactive webview for visualization. The architecture follows a pipeline pattern where source files are analyzed, their structure extracted, relationships mapped via an edge graph, and documentation generated through LLM-assisted enrichment.

With 176 source files, 1052 graph nodes, and 2158 edges, the codebase demonstrates moderate internal coupling with clear separation of concerns between parsing, storage, visualization, and protocol layers.

**Inputs:** Node.js built-ins (fs, path, child_process), Tree-sitter for parsing, Zod for schema validation, React for webview UI, VS Code Extension API for IDE integration.

**Outputs:** MCP tools (file_info, folder_info, report_file_info, report_folder_info, inspect_source, open_window), .arch/ documentation files, static graph visualization HTML.

## Architecture
The architecture follows a layered design with clear data flow:

**Protocol Layer** (`mcp/`): Handles MCP communication via stdio transport. The server registers tools and routes requests to handlers in tools.ts.

**Information Extraction Layer** (`info/`): Processes source files and folders to generate structured prompts. Uses the parser and graph layers to collect signatures, relationships, and statistics.

**Parser Layer** (`parser/`): Tree-sitter based code analysis. Extracts AST information including function signatures, class definitions, imports, and exports. Supports TypeScript/JavaScript with extensible language support.

**Graph Layer** (`graph/`): EdgeList-based dependency tracking. Maintains import edges and function call edges between files. Supports filtering, querying, and serialization for persistence.

**Artifact Layer** (`artifact/`): Shadow filesystem management. Maps source paths to artifact paths in `.arch/`. Handles creation, indexing, and retrieval of documentation files.

**Visualization Layer** (`webview/`): React-based interactive UI. Renders the dependency graph with D3-style force layout, supports node selection, edge highlighting, and folder grouping.

**Data Flow**: Source files → Parser (AST extraction) → Graph (relationship tracking) → Info (prompt generation) → MCP (host LLM enrichment) → Artifact (documentation storage).

## Key Files
- **mcp/tools.ts**: MCP tool definitions and handlers. Implements file_info, folder_info, report_file_info, report_folder_info, inspect_source, and open_window tools that expose LLMem functionality to the Antigravity Agent.
- **mcp/server.ts**: MCP server implementation using stdio transport. Handles tool registration, request routing, and protocol communication with the host IDE.
- **artifact/service.ts**: Core artifact management service. Handles initialization, creation, and retrieval of artifacts. Manages the .arch/ shadow filesystem and gitignore-aware file filtering.
- **graph/edgelist.ts**: EdgeList data structure for tracking import and function call relationships between files. Provides graph operations for dependency analysis and visualization.
- **parser/typescript.ts**: Tree-sitter based TypeScript parser. Extracts function signatures, class definitions, imports, and exports from source files.
- **info/folder.ts**: Folder information extraction. Generates structural analysis prompts for LLM enrichment by aggregating file signatures and edge relationships.
- **info/file.ts**: File information extraction. Generates detailed file documentation prompts including function purposes, implementation details, and relationships.
- **webview/ui/graph/Graph.tsx**: React component for interactive graph visualization. Renders nodes and edges with pan/zoom navigation and selection highlighting.
