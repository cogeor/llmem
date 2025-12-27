# Graph Module

The graph module provides edge list storage and graph building for import dependencies and function calls.

## File Structure

```
src/graph/
├── edgelist.ts         # Edge list storage (ImportEdgeListStore, CallEdgeListStore)
├── index.ts            # Graph building from edge lists
├── types.ts            # Graph type definitions
├── webview-data.ts     # Transform edge lists for webview visualization
├── worktree-state.ts   # Track watched files for lazy computation
├── utils.ts            # Helper functions
├── artifact-converter.ts # Legacy artifact conversion (deprecated)
└── plot/
    ├── generator.ts    # Static graph visualization
    └── template.ts     # HTML template for plots
```

## Edge List Storage (`edgelist.ts`)

The primary data store for graph relationships. Uses JSON files with in-memory caching.

### Data Format

```typescript
interface EdgeListData {
    version: string;           // "1.0.0"
    timestamp: string;         // ISO date
    nodes: NodeEntry[];
    edges: EdgeEntry[];
}

interface NodeEntry {
    id: string;                // "src/parser/ts-service.ts::getTypeScriptFiles"
    name: string;              // "getTypeScriptFiles"
    kind: 'file' | 'function' | 'class' | 'method' | 'arrow' | 'const';
    fileId: string;            // "src/parser/ts-service.ts"
}

interface EdgeEntry {
    source: string;            // Node ID or file ID
    target: string;            // Node ID or file ID
    kind: 'import' | 'call';
}
```

### Storage Classes

**ImportEdgeListStore** — File-to-file import relationships
- Stored in `.artifacts/import-edgelist.json`
- Nodes: Files in the codebase
- Edges: Import dependencies between files

**CallEdgeListStore** — Function-to-function call relationships
- Stored in `.artifacts/call-edgelist.json`
- Nodes: Functions, methods, classes
- Edges: Call relationships between functions
- **TypeScript/JavaScript only** (other languages don't support call graphs)

### API

```typescript
class ImportEdgeListStore {
    load(): Promise<void>
    save(): Promise<void>
    addFileWithImports(fileId: string, imports: ImportInfo[]): void
    removeFile(fileId: string): void
    getNodes(): NodeEntry[]
    getEdges(): EdgeEntry[]
}

class CallEdgeListStore {
    load(): Promise<void>
    save(): Promise<void>
    addFileWithCalls(fileId: string, functions: FunctionInfo[]): void
    removeFile(fileId: string): void
    getNodes(): NodeEntry[]
    getEdges(): EdgeEntry[]
}
```

## Graph Building (`index.ts`)

Builds typed graph structures from edge list data.

### Types (`types.ts`)

```typescript
// Import Graph (file-level)
interface FileNode extends Node {
    kind: 'file';
    path: string;      // Repo-relative path
    language: string;
}

interface ImportEdge extends Edge {
    kind: 'import';
    specifiers: Array<{ name: string; alias?: string }>;
}

type ImportGraph = Graph<FileNode, ImportEdge>;

// Call Graph (function-level)
interface EntityNode extends Node {
    kind: 'function' | 'method' | 'class' | 'constructor';
    fileId: string;
    signature?: string;
}

interface CallEdge extends Edge {
    kind: 'call';
    callSiteId: string;
}

type CallGraph = Graph<EntityNode, CallEdge>;
```

### Functions

```typescript
// Build graphs from split edge lists
function buildGraphsFromSplitEdgeLists(
    importData: EdgeListData,
    callData: EdgeListData,
    watchedFiles?: Set<string>
): { importGraph: ImportGraph; callGraph: CallGraph }

// Check if file supports call graph (TS/JS only)
function isTypeScriptFile(filePath: string): boolean
```

## Worktree State (`worktree-state.ts`)

Manages which files are "watched" for edge computation.

- Lazy computation: Edges only computed for watched files
- Persisted to `.artifacts/worktree-state.json`
- Supports file and folder toggles

## Webview Data (`webview-data.ts`)

Transforms edge lists into the format expected by the webview.

```typescript
function prepareWebviewDataFromEdgeList(
    workspaceRoot: string
): Promise<WebviewGraphData>
```

## Design Principles

1. **Internal-only edges**: Only edges between files in the repository are stored. External imports (node_modules, built-ins) are excluded from graph edges.

2. **Lazy computation**: Edges are computed on-demand when files are "watched" in the UI, reducing startup time for large codebases.

3. **In-memory with persistence**: Edge lists are loaded into memory for fast access, with periodic saves to disk when dirty.

4. **Language-aware**: Call graphs are only available for TypeScript/JavaScript. Other languages (Python, C++, Rust, R) only produce import graphs.
