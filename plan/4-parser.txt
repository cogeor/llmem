# Part 4: Text Processing Implementation Plan
# Component: src/parser/

================================================================================
## PURPOSE
================================================================================
Robust code structure extraction using TypeScript Compiler API (primary) and Tree-sitter (fallback).
Parses source files into AST, extracts semantic information (resolved imports, full signatures, cross-file references),
and stores as structured JSON in `.artifact` files.

DESIGN GOAL: For each source file, generate a corresponding .artifact file containing
rich structural data (entities + callsites) and semantic edges (resolved paths) to enable validation and graph construction.

Example:
  src/extension/config.ts → .artifacts/src/extension/config.ts.artifact

================================================================================
## FILES & RESPONSIBILITIES
================================================================================

### interfaces.ts
- `ArtifactExtractor`: Common interface for all language extractors.

### ts-extractor.ts (Primary for TS/JS)
- Implements `ArtifactExtractor`.
- Uses `ts.Program` and `ts.TypeChecker`.
- Extracts:
    - **Imports**: Resolves module specifiers to absolute paths.
    - **Exports**: Analyzes symbol exports and re-exports.
    - **Entities**: Extracts functions, classes, methods with signatures.
    - **Call Sites**: Finds references (calls/new) within entities.

### ts-service.ts
- Manages `ts.Program` lifecycle.
- Provides singleton access to the Program for the workspace.
- Handles creation of temporary programs for files not in the main project config.

### extractor.ts (Fallback / Non-TS)
- Uses Tree-sitter and S-expression queries.
- Legacy extraction logic for generic file support.

### parser.ts
- Tree-sitter initialization and language detection.

### types.ts
- `FileArtifact`, `Entity`, `ImportSpec`, `CallSite` interfaces.

================================================================================
## DATA MODEL (Artifact JSON Structure)
================================================================================

```typescript
type Loc = {
  startByte: number; endByte: number;
  startLine: number; endLine: number;
  startColumn: number; endColumn: number;
};

type FileArtifact = {
  schemaVersion: "ts-graph-v1";
  file: { id: string; path: string; language: string };
  imports: ImportSpec[];
  exports: ExportSpec[];
  entities: Entity[];
};

type ImportSpec = {
  kind: "es";
  source: string;             // raw module specifier
  resolvedPath: string | null; // Resolved absolute path (populated by TS extractor)
  specifiers: { name: string; alias?: string }[];
  loc: Loc;
};

type ExportSpec = {
  type: "named" | "default" | "reexport" | "all";
  name: string;      // exported name
  localName?: string; // local entity name if different
  source?: string;   // for re-exports
  loc: Loc;
};

type EntityKind = "class" | "function" | "method" | "arrow" | "const";

type Entity = {
  id: string; // generated stable ID (e.g. file#name@byte)
  kind: EntityKind;
  name: string;
  isExported: boolean;
  loc: Loc;
  signature?: string; // full signature text
  calls?: CallSite[]; // outgoing calls
};

type CallSite = {
  callSiteId: string;
  kind: "function" | "method" | "new";
  calleeName: string; // best effort name extraction
  loc: Loc;
};
```

================================================================================
## IMPLEMENTATION STRATEGY
================================================================================

1.  **TypeScript Service**:
    -   Initialize with workspace root.
    -   Load `tsconfig.json` or create default configuration.
    -   Expose `getProgram()` method.

2.  **TypeScript Extractor**:
    -   Uses `program.getSourceFile(path)`.
    -   Uses `program.getTypeChecker()` to resolve symbols and paths.
    -   Traverses AST (forEachChild) to find nodes.
    -   Populates `resolvedPath` in `ImportSpec`.

3.  **Fallback Strategy**:
    -   If file is not TS/JS/TSX, or if TS extractor fails (fails to parse), use `OutlineGenerator` (Tree-sitter).
    -   Ensures continued support for other languages or loose files.

4.  **Service Integration**:
    -   `src/artifact/service.ts` initializes `TypeScriptService` and `TypeScriptExtractor`.
    -   `ensureArtifacts` checks extension and selects extractor.

================================================================================
## VERIFICATION
================================================================================

-   **Unit Tests**: `src/test/artifact/service.test.ts` verifies artifacts are generated from source.
-   **Semantic Check**: Verify `imports` contain valid `resolvedPath`.
