# Info Module

The info module generates documentation for files and folders, providing data for MCP tools.

## File Structure

```
src/info/
├── extractor.ts      # Extract file structure (imports, exports, functions)
├── folder.ts         # Folder-level analysis using edge list data
├── mcp.ts            # MCP integration (prompts, data preparation)
├── renderer.ts       # Format as markdown
├── filter.ts         # File filtering utilities
├── types.ts          # FileInfo, FunctionInfo, etc.
├── reverse-index.ts  # Caller lookup from edge lists
├── index.ts          # Module exports
├── cli.ts            # CLI for file info
└── cli_folder.ts     # CLI for folder info
```

## MCP Integration (`mcp.ts`)

Provides data for the `file_info` and `folder_info` MCP tools.

```typescript
// Get file info for MCP tool
getFileInfoForMcp(workspaceRoot, relativePath): Promise<{
    filePath: string;
    markdown: string;
    sourceCode: string;
}>

// Build prompt for LLM enrichment
buildEnrichmentPrompt(filePath, markdown, sourceCode): string
```

## File Analysis (`extractor.ts`)

Extracts structural information from source files.

```typescript
interface FileInfo {
    path: string;
    imports: ImportInfo[];
    exports: ExportInfo[];
    functions: FunctionInfo[];
    classes: ClassInfo[];
}

extractFileInfo(filePath, workspaceRoot): Promise<FileInfo>
```

## Folder Analysis (`folder.ts`)

Summarizes folder contents using edge list data.

```typescript
getFolderInfoForMcp(workspaceRoot, folderPath): Promise<FolderData>
buildFolderEnrichmentPrompt(folderPath, data): string
```

## Reverse Index (`reverse-index.ts`)

Builds caller lookup from call edge list.

```typescript
buildReverseCallIndex(callData): Map<string, CallerInfo[]>
```

## CLI Tools

```bash
npm run file-info          # Basic file info
npm run file-info:sig      # With signatures
npm run file-info:semantic # Semantic analysis
npm run module-info        # Folder info
```
