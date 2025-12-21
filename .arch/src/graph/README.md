# FOLDER: src/graph

## Overview
The `src/graph` module is the core data layer for representing and manipulating the codebase structure as a graph. It provides the EdgeList data structure that stores nodes (files, classes, functions, methods) and edges (imports, call relationships) extracted from source code artifacts. This module serves as the central data hub that feeds both the webview visualization and the semantic documentation tools.

**Statistics:** 48 files, 208 graph nodes, 316 graph edges

**Inputs:** File artifacts from the parser module, TypeScript source files for extraction, worktree file modification timestamps

**Outputs:** EdgeListStore instances, WebviewData for visualization, filtered edge/node lists, WorktreeState status information

## Architecture
The module follows a **data transformation pipeline**: FileArtifacts → EdgeList → WebviewData.

**Core Components:**
- `EdgeListStore` hierarchy: BaseEdgeListStore provides common functionality, with specialized ImportEdgeListStore and CallEdgeListStore for different edge types. The combined EdgeListStore manages both.
- `WorktreeState`: Tracks file modification times and computes status (current/outdated/never) for files and folders, enabling incremental updates.

**Data Flow:**
1. Parser generates FileArtifacts from source files
2. `artifact-converter` transforms artifacts into nodes and edges
3. `EdgeListStore` persists graph to `.artifacts/edgelist.json`
4. `webview-data` prepares visualization-ready data
5. `worktree-state` tracks which files need regeneration

**Dependencies:** Minimal external dependencies beyond Node.js fs/path. External modules depend on EdgeListStore but the graph module has minimal outward dependencies. Integrates with the parser module for input and webview module for output.

## Key Files
- **edgelist.ts**: Core EdgeListStore classes (BaseEdgeListStore, ImportEdgeListStore, CallEdgeListStore, EdgeListStore) for storing, persisting, and querying nodes/edges. Handles load/save to JSON, dirty tracking, and file-based operations.
- **artifact-converter.ts**: Converts FileArtifact objects from the parser into EdgeList format. Contains artifactToEdgeList, resolveImportTarget, resolveCallToEdge, and artifactsToEdgeList functions.
- **webview-data.ts**: Transforms EdgeList data into WebviewData format for the graph visualization. Prepares node positions, edge connections, and metadata for rendering.
- **worktree-state.ts**: Manages worktree state tracking including file modification times, status computation (current/outdated/never), and folder status aggregation via WorktreeState class.
- **utils.ts**: Utility functions for ID derivation (deriveNodeId), path normalization (normalizePath), and graph data manipulation helpers.
- **types.ts**: TypeScript type definitions for graph structures including GraphNode, GraphEdge, EdgeKind, NodeKind, and related interfaces.
