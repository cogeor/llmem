# MCP Module

The MCP (Model Context Protocol) module exposes tools for AI agents to analyze and document codebases.

## File Structure

```
src/mcp/
├── server.ts       # MCP server initialization with stdio transport
├── tools.ts        # Tool definitions and handlers
├── handlers.ts     # Request validation, response formatting
├── path-utils.ts   # Workspace path validation utilities
└── observer.ts     # Request/response logging
```

## Tools

### `file_info`

Extract file structure and return enrichment prompt for LLM documentation.

```typescript
FileInfoSchema = z.object({
    workspaceRoot: z.string(),  // Absolute path to workspace
    path: z.string(),           // Relative path to file
});
```

**Response**: `prompt_ready` with enrichment prompt for the host LLM.

### `report_file_info`

Callback to save LLM-generated file documentation.

```typescript
ReportFileInfoSchema = z.object({
    workspaceRoot: z.string(),
    path: z.string(),
    overview: z.string(),
    inputs: z.string().optional(),
    outputs: z.string().optional(),
    functions: z.array(z.object({
        name: z.string(),
        purpose: z.string(),
        implementation: z.string(),
    })),
});
```

**Output**: Saves to `.arch/<path>.md`

### `folder_info`

Extract folder structure and return enrichment prompt.

```typescript
FolderInfoSchema = z.object({
    workspaceRoot: z.string(),
    path: z.string(),           // Relative path to folder
});
```

**Response**: `prompt_ready` with folder enrichment prompt.

### `report_folder_info`

Callback to save LLM-generated folder documentation.

```typescript
ReportFolderInfoSchema = z.object({
    workspaceRoot: z.string(),
    path: z.string(),
    overview: z.string(),
    inputs: z.string().optional(),
    outputs: z.string().optional(),
    key_files: z.array(z.object({
        name: z.string(),
        summary: z.string(),
    })),
    architecture: z.string(),
});
```

**Output**: Saves to `.arch/<folder>/README.md`

### `inspect_source`

Read specific lines from a source file.

```typescript
InspectSourceSchema = z.object({
    path: z.string(),       // Relative path
    startLine: z.number(),  // 1-indexed
    endLine: z.number(),    // 1-indexed
});
```

### `open_window`

Open the LLMem webview panel (VS Code/Antigravity only).

```typescript
OpenWindowSchema = z.object({
    viewColumn: z.number().optional(),  // 1-3
});
```

## Two-Phase Documentation Flow

```
1. Agent calls file_info(path)
   → Extract imports, exports, functions
   → Build enrichment prompt with source code
   → Return prompt_ready response

2. Host LLM processes prompt
   → Reads source code
   → Generates overview and function summaries

3. Agent calls report_file_info(enriched data)
   → Format as markdown design document
   → Save to .arch/<path>.md
   → Return success
```

## Path Security

All tools validate paths to prevent directory traversal:

```typescript
// path-utils.ts
validateWorkspaceRoot(root)        // Ensure root exists and is absolute
validateWorkspacePath(root, path)  // Ensure path stays within workspace
writeFileInWorkspace(root, path, content)  // Safe file write
readFileInWorkspace(root, path)    // Safe file read
```

## Server Initialization

```typescript
// server.ts
export async function startServer(
    config: Config,
    workspaceRoot: string
): Promise<void>
```

Uses MCP SDK with stdio transport for communication with AI agents.

## Response Types

```typescript
// handlers.ts
formatSuccess(data)           // Successful response
formatError(message)          // Error response
formatPromptResponse(         // Response requiring LLM action
    prompt,
    callbackTool,
    callbackArgs
)
```

## Observability

All tool calls are wrapped with `withObservation()` for logging:

```typescript
// observer.ts
export const handleFileInfo = withObservation(
    jsonConsoleObserver,
    { requestId, method, toolName },
    handleFileInfoImpl
);
```
