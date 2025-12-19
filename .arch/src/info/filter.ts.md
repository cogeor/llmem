# DESIGN DOCUMENT: src/info/filter.ts

> **Instructions:** This document serves as a blueprint for implementing the source code. Review the specifications below before writing code.

---

## FILE OVERVIEW

**Purpose:** Provides graph filtering utilities to exclude external dependencies (node_modules) and extract specific edge/node subsets from edge lists.

**Dependencies:**
- `../graph/edgelist` → `EdgeEntry`, `NodeEntry` types

**Inputs:** Arrays of `EdgeEntry` and `NodeEntry` from graph edge lists.
**Outputs:** Filtered arrays based on path patterns and edge kinds.

**Key Concepts:**
- **External Path:** Any path containing `node_modules`.
- **Edge Kinds:** `import` vs `call`.
- **Entity ID Format:** Call edges use `fileId::entityName` for source/target.

---

## FUNCTION SPECIFICATIONS

### `isExternalPath(path: string): boolean`
**Purpose:** Checks if a path references an external library.
**Implementation:**
- Returns `true` if `path` includes the string `'node_modules'`.
- Returns `false` otherwise.

### `filterImportEdges(edges: EdgeEntry[]): EdgeEntry[]`
**Purpose:** Removes import edges that point to external dependencies.
**Implementation:**
- Filters the input `edges` array.
- Retains edges where:
  - `kind` is NOT `'import'`, OR
  - `target` is NOT external (checked via `isExternalPath`).

### `filterInternalEdges(edges: EdgeEntry[]): EdgeEntry[]`
**Purpose:** Keeps only edges where both the source and target are internal project files.
**Implementation:**
- Filters the input `edges` array.
- Retains edges where:
  - `source` is NOT external, AND
  - `target` is NOT external.

### `getImportEdges(edges: EdgeEntry[]): EdgeEntry[]`
**Purpose:** Extracts only import-type edges.
**Implementation:**
- Returns edges where `kind === 'import'`.

### `getCallEdges(edges: EdgeEntry[]): EdgeEntry[]`
**Purpose:** Extracts only call-type edges.
**Implementation:**
- Returns edges where `kind === 'call'`.

### `getEdgesFromFile(edges: EdgeEntry[], fileId: string): EdgeEntry[]`
**Purpose:** Gets all edges originating from a specific file.
**Implementation:**
- Filters `edges` to find those matching `fileId`.
- **Import Rules:** Match if `edge.source === fileId`.
- **Call Rules:** Match if `edge.source` starts with `${fileId}::`.

### `getNodesForFile(nodes: NodeEntry[], fileId: string): NodeEntry[]`
**Purpose:** Gets all nodes belonging to a specific file.
**Implementation:**
- Filters `nodes` where `node.fileId === fileId`.

---

## CONTROL FLOW

Typically used in `cli.ts` or `mcp.ts` pipeline:
1. **Extraction:** Artifacts converted to raw edge list.
2. **Filtering:**
   - Get imports: `getImportEdges()` -> `filterImportEdges()`
   - Get calls: `getCallEdges()` -> `getEdgesFromFile()`
3. **Usage:** Filtered lists used for visualization or reports.
