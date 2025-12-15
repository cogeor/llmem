# File Info Module

## Overview

The `file_info` module generates human-readable markdown documentation for source files with function signatures and call graph relationships.

## Current Implementation

### File Structure

```
src/info/
├── index.ts          # Public API, generateAllFileInfo(), generateAndSaveAllFileInfo()
├── extractor.ts      # extractFileInfo() - extracts from artifacts + graph
├── renderer.ts       # renderFileInfoMarkdown() - converts to markdown
├── types.ts          # FileInfo, FunctionInfo, ClassInfo, CallerInfo
└── reverse-index.ts  # buildReverseCallIndex() - caller lookup
```

### Public API

```typescript
// Generate markdown for all files
generateAllFileInfo(rootDir, artifactsDir?): Promise<Map<string, string>>

// Generate and save to .artifacts/
generateAndSaveAllFileInfo(rootDir): Promise<string[]>

// Single file
generateSingleFileInfo(fileId, artifact, reverseIndex): string
```

### Output Format

```markdown
# src/graph/utils.ts

## Functions

### `normalizePath(p: string): string` *(exported)*

**Called by:**
- `buildImportBindings` in `src/graph/callGraph/resolution.ts`

## Classes

### `ColorGenerator` *(exported)*

#### Methods

##### `getColor(id: string): string`
```

> Note: "Called by:" section omitted when no callers exist.

## Data Flow

```mermaid
graph LR
    A[.artifacts/*.artifact] --> B[readArtifacts]
    B --> C[buildCallGraph]
    C --> D[buildReverseCallIndex]
    D --> E[extractFileInfo]
    E --> F[renderFileInfoMarkdown]
    F --> G[.artifacts/src/path/file.md]
```

## MCP Integration (Planned)

New file `src/info/mcp.ts` will add:
- `buildEnrichmentPrompt()` - LLM prompt for semantic summaries
- `getFileInfoForMcp()` - Prepares data for MCP tool
- `saveEnrichedFileInfo()` - Saves LLM-enriched markdown
