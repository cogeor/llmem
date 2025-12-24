# MCP Server Implementation

> **Last Updated:** 2025-12-24
>
> This document describes the implementation choices for the LLMem MCP (Model Context Protocol) server.

## Table of Contents

1. [Overview](#overview)
2. [Architecture Principles](#architecture-principles)
3. [Workspace Root Management](#workspace-root-management)
4. [Path Validation & Security](#path-validation--security)
5. [Observability](#observability)
6. [Deployment Modes](#deployment-modes)
7. [Tool Reference](#tool-reference)
8. [Best Practices](#best-practices)

---

## Overview

The LLMem MCP server exposes tools for AI agents to analyze and document codebases. It is designed to be **packaging-agnostic** and can run as:

- **VS Code Extension** - Integrated into VS Code/Antigravity IDE
- **Claude Code Extension** - Integrated into Claude Code CLI
- **Standalone Server** - Running via stdio transport with explicit configuration

The server maintains strict workspace boundaries and never makes assumptions about file locations.

---

## Architecture Principles

### 1. **No Hardcoded Paths**

The MCP server module (`src/mcp/`) contains **zero hardcoded paths**. All paths are:

- Provided explicitly by the client (extension/plugin)
- Validated against workspace boundaries
- Resolved relative to the workspace root

### 2. **Explicit Over Implicit**

The server **never infers** workspace context from:

- ❌ `process.cwd()` (current working directory)
- ❌ Environment variables (except in standalone mode with explicit LLMEM_WORKSPACE)
- ❌ File system scanning to "find" a project root
- ✅ Always uses workspace root provided by client

### 3. **Defense in Depth**

Multiple layers of validation:

1. **Schema validation** - Zod schemas enforce required parameters
2. **Workspace validation** - Check workspace root exists and is a directory
3. **Path validation** - Ensure all paths stay within workspace
4. **Observation** - All requests logged with correlation IDs

### 4. **Packaging Agnostic**

The MCP server is designed to work with any client/host that can:

- Start the server process
- Provide a valid workspace root
- Communicate via MCP protocol over stdio

---

## Workspace Root Management

### Problem Statement

**Previous Implementation Issues:**

- Used optional `workspaceRoot` parameters with fallbacks to `process.cwd()`
- Files were saved to wrong locations (extension AppData instead of user workspace)
- No validation that paths stayed within workspace boundaries
- `getEffectiveWorkspaceRoot()` had complex fallback logic that was unreliable

**Root Cause:**

MCP servers launched by IDE plugins often run from the plugin installation directory, not the user's workspace. Using `process.cwd()` would cause files to be written to the wrong location.

### Solution

#### **Required Workspace Root**

All file/folder tools now **require** `workspaceRoot` as a mandatory parameter:

```typescript
export const FileInfoSchema = z.object({
    workspaceRoot: z.string().describe('Absolute path to workspace root'),
    path: z.string().describe('Path to file (relative to workspace root)'),
});
```

#### **Client Responsibility**

The **client** (VS Code extension, Claude Code extension, etc.) is responsible for:

1. Determining the correct workspace root
2. Passing it explicitly to every MCP tool call
3. Failing gracefully if no workspace is available

**Example: VS Code Extension**

```typescript
async function startMcpServer(config: Config): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspaceRoot) {
        throw new Error('Cannot start MCP server: No workspace folder is open.');
    }

    await startServer(config, workspaceRoot);
}
```

#### **Validation**

The server validates workspace roots before any file operations:

```typescript
import { validateWorkspaceRoot } from './path-utils';

// In handler
validateWorkspaceRoot(workspaceRoot); // Throws if invalid
```

### Deployment Modes

#### **1. Extension Mode (VS Code, Claude Code)**

- Workspace root provided by extension API
- Stored in server for tools that need it (`inspect_source`, `open_window`)
- Tools like `file_info` still require explicit `workspaceRoot` in parameters

**Flow:**

```
Extension starts → Calls startServer(config, workspaceRoot)
                → Server stores workspace root
                → Tools validate and use workspace root
```

#### **2. Standalone Mode**

- Requires `LLMEM_WORKSPACE` environment variable
- **Never** falls back to `process.cwd()`
- Fails with clear error if `LLMEM_WORKSPACE` not set

**Usage:**

```bash
LLMEM_WORKSPACE=/path/to/project node dist/mcp/server.js
```

**Why this is required:**

- Prevents accidentally operating on wrong directory
- Makes workspace context explicit and auditable
- Consistent with extension mode behavior

---

## Path Validation & Security

### Validation Utilities (`src/mcp/path-utils.ts`)

#### **`validateWorkspacePath(workspaceRoot, relativePath)`**

Ensures a path stays within workspace boundaries:

```typescript
import { validateWorkspacePath } from './path-utils';

// Valid
validateWorkspacePath('/home/user/project', 'src/file.ts');
// Returns: '/home/user/project/src/file.ts'

// Invalid (directory traversal)
validateWorkspacePath('/home/user/project', '../../../etc/passwd');
// Throws: Error - path escapes workspace root
```

**Implementation:**

1. Resolve workspace root to absolute path
2. Resolve target path relative to workspace root
3. Check that target starts with workspace root + path separator
4. Prevents `../` directory traversal attacks

#### **`validateWorkspaceRoot(workspaceRoot)`**

Validates workspace root is a valid directory:

```typescript
validateWorkspaceRoot(workspaceRoot);
// Throws if:
// - workspaceRoot is empty/null
// - Path doesn't exist
// - Path is not a directory
```

#### **Safe File Operations**

Helper functions that combine path validation with file I/O:

- `readFileInWorkspace(workspaceRoot, relativePath, encoding)` - Read file safely
- `writeFileInWorkspace(workspaceRoot, relativePath, content, encoding)` - Write file safely (creates parent dirs)
- `fileExistsInWorkspace(workspaceRoot, relativePath)` - Check existence safely
- `ensureDirectoryInWorkspace(workspaceRoot, relativePath)` - Create directory safely

**All functions:**
- Validate path against workspace boundary
- Throw descriptive errors if validation fails
- Use absolute paths internally

---

## Observability

### Observer Pattern (`src/mcp/observer.ts`)

All tool handlers are wrapped with observation to provide structured logging.

#### **Observer Interface**

```typescript
interface Observer {
    onStart: (ctx: ObserverContext, params: unknown) => void;
    onEnd: (ctx: ObserverContext, result: unknown) => void;
    onError: (ctx: ObserverContext, err: unknown) => void;
}
```

#### **JSON Console Observer**

Logs structured JSON events to stderr:

```typescript
import { jsonConsoleObserver, withObservation } from './observer';

const handler = withObservation(
    jsonConsoleObserver,
    {
        requestId: generateCorrelationId(),
        method: 'tools/call',
        toolName: 'file_info',
    },
    async (params) => {
        // actual implementation
        return result;
    }
);
```

#### **Log Events**

**Request Start:**
```json
{
  "event": "mcp.request.start",
  "timestamp": "2025-12-24T10:30:00.000Z",
  "requestId": "mcp-1234567890-abc123",
  "method": "tools/call",
  "toolName": "file_info",
  "params": {
    "workspaceRoot": "/home/user/project",
    "path": "src/main.ts"
  }
}
```

**Request End:**
```json
{
  "event": "mcp.request.end",
  "timestamp": "2025-12-24T10:30:01.500Z",
  "requestId": "mcp-1234567890-abc123",
  "method": "tools/call",
  "toolName": "file_info",
  "durationMs": 1500,
  "resultSummary": {
    "type": "object",
    "keys": ["status", "promptForHostLLM", "callbackTool"]
  }
}
```

**Request Error:**
```json
{
  "event": "mcp.request.error",
  "timestamp": "2025-12-24T10:30:01.200Z",
  "requestId": "mcp-1234567890-abc123",
  "method": "tools/call",
  "toolName": "file_info",
  "durationMs": 1200,
  "errorType": "Error",
  "errorMessage": "File not found: src/missing.ts"
}
```

#### **Benefits**

1. **Debugging** - Trace requests with correlation IDs
2. **Performance** - Measure handler duration
3. **Reliability** - Track error rates and types
4. **Security** - Sensitive fields (tokens, passwords) are redacted
5. **Auditing** - Full request/response lifecycle captured

---

## Deployment Modes

### 1. VS Code Extension

**File:** `src/extension/extension.ts`

The extension provides workspace context to the MCP server:

```typescript
import { startServer } from '../mcp/server';

async function startMcpServer(config: Config): Promise<void> {
    // Get workspace from VS Code API
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspaceRoot) {
        throw new Error('Cannot start MCP server: No workspace folder is open.');
    }

    // Pass workspace to MCP server
    await startServer(config, workspaceRoot);
}
```

**Workspace Detection:**
- Uses `vscode.workspace.workspaceFolders` API
- Fails if no folder is open (no fallback)
- Clear error message guides user to open a workspace

### 2. Claude Code Extension

**Integration Pattern:**

```typescript
import { startServer } from './mcp/server';

// Get workspace from Claude Code context
const workspaceRoot = claudeCode.workspace.root;

if (!workspaceRoot) {
    throw new Error('Workspace root not available');
}

await startServer(config, workspaceRoot);
```

**Key Point:** The client (extension/plugin) determines workspace root using its own APIs. The MCP server just receives it.

### 3. Standalone Mode

**Usage:**

```bash
# Set workspace explicitly
export LLMEM_WORKSPACE=/path/to/project

# Start server
node dist/mcp/server.js
```

**Error Handling:**

```
[MCP] ERROR: LLMEM_WORKSPACE environment variable is required.
[MCP] Usage: LLMEM_WORKSPACE=/path/to/workspace node dist/mcp/server.js
[MCP] The workspace root must be explicitly provided - never inferred.
```

**Use Cases:**
- Testing MCP tools independently
- CI/CD pipelines
- Remote MCP servers
- Custom integrations

---

## Tool Reference

### `file_info`

**Purpose:** Get semantic documentation for a source file

**Parameters:**
- `workspaceRoot` (required): Absolute path to workspace root
- `path` (required): Relative path to file

**Returns:** `prompt_ready` response with enrichment prompt

**Example:**
```json
{
  "workspaceRoot": "/home/user/project",
  "path": "src/main.ts"
}
```

**Callback:** Must call `report_file_info` with LLM response

---

### `report_file_info`

**Purpose:** Save LLM-enriched documentation

**Parameters:**
- `workspaceRoot` (required): Absolute path to workspace root
- `path` (required): Relative path to file
- `overview` (required): File overview
- `inputs` (optional): What file takes as input
- `outputs` (optional): What file produces
- `functions` (required): Array of enriched function docs

**Saves:** `.arch/{path}.md` in workspace

**Example:**
```json
{
  "workspaceRoot": "/home/user/project",
  "path": "src/main.ts",
  "overview": "Main entry point for application",
  "functions": [
    {
      "name": "main",
      "purpose": "Initialize and start application",
      "implementation": "- Loads config\n- Starts server\n- Handles shutdown"
    }
  ]
}
```

---

### `folder_info`

**Purpose:** Get semantic documentation for a folder

**Parameters:**
- `workspaceRoot` (required): Absolute path to workspace root
- `path` (required): Relative path to folder

**Returns:** `prompt_ready` response with enrichment prompt

**Callback:** Must call `report_folder_info` with LLM response

---

### `report_folder_info`

**Purpose:** Save LLM-enriched folder documentation

**Parameters:**
- `workspaceRoot` (required): Absolute path to workspace root
- `path` (required): Relative path to folder
- `overview` (required): Folder overview
- `inputs` (optional): External dependencies
- `outputs` (optional): Public API
- `key_files` (required): Array of key files
- `architecture` (required): Architecture description

**Saves:** `.arch/{path}/README.md` in workspace

---

### `inspect_source`

**Purpose:** Read specific lines from a source file

**Parameters:**
- `path` (required): Relative path to file
- `startLine` (required): Start line (1-indexed)
- `endLine` (required): End line (1-indexed)

**Note:** Uses stored workspace root from server initialization

---

### `open_window`

**Purpose:** Generate and open the LLMem webview

**Parameters:**
- `viewColumn` (optional): View column (1-3)

**Note:** Uses stored workspace root from server initialization

---

## Best Practices

### For Extension/Plugin Developers

1. **Always provide workspace root explicitly**
   ```typescript
   // ✅ Good
   await mcp.call('file_info', {
       workspaceRoot: workspace.root,
       path: 'src/file.ts'
   });

   // ❌ Bad (will fail)
   await mcp.call('file_info', {
       path: 'src/file.ts'
   });
   ```

2. **Validate workspace before starting server**
   ```typescript
   if (!workspaceRoot) {
       throw new Error('Workspace required');
   }
   await startServer(config, workspaceRoot);
   ```

3. **Use absolute paths for workspace root**
   ```typescript
   // ✅ Good
   const root = path.resolve(workspaceRoot);

   // ❌ Bad
   const root = './project';
   ```

### For MCP Tool Users (AI Agents)

1. **Always pass workspace root to tools**
   - `file_info`, `report_file_info`, `folder_info`, `report_folder_info` all require it

2. **Use relative paths for files/folders**
   ```json
   {
     "workspaceRoot": "/absolute/path/to/workspace",
     "path": "relative/path/to/file.ts"
   }
   ```

3. **Complete the enrichment workflow**
   - Call `file_info` → Process prompt → Call `report_file_info`
   - Call `folder_info` → Process prompt → Call `report_folder_info`

### For Server Operators (Standalone Mode)

1. **Always set LLMEM_WORKSPACE**
   ```bash
   export LLMEM_WORKSPACE=/path/to/project
   node dist/mcp/server.js
   ```

2. **Monitor logs for errors**
   - All events logged to stderr as JSON
   - Use `jq` for filtering: `node dist/mcp/server.js 2>&1 | jq`

3. **Validate workspace before starting**
   ```bash
   if [ ! -d "$LLMEM_WORKSPACE" ]; then
       echo "Workspace does not exist: $LLMEM_WORKSPACE"
       exit 1
   fi
   ```

---

## Migration Guide

### Migrating from Old Implementation

If you have code using the old MCP tools:

**Before:**
```typescript
// Optional workspace root with fallback
await mcp.call('file_info', {
    path: 'src/file.ts'
    // workspaceRoot was optional
});
```

**After:**
```typescript
// Required workspace root
await mcp.call('file_info', {
    workspaceRoot: workspace.root, // Now required
    path: 'src/file.ts'
});
```

**Key Changes:**
1. `workspaceRoot` is now **required** (not optional)
2. All paths are **validated** against workspace boundaries
3. No fallbacks to `process.cwd()` or environment variables (except standalone mode)
4. Files are **always saved to correct location** (`.arch/` in workspace)

---

## Troubleshooting

### Files saved to wrong location

**Symptom:** Files appear in `%APPDATA%` or extension directory instead of workspace

**Cause:** Missing `workspaceRoot` parameter in tool call

**Solution:** Always pass `workspaceRoot` explicitly:
```typescript
await mcp.call('report_file_info', {
    workspaceRoot: workspace.root, // Add this
    path: 'src/file.ts',
    // ... other params
});
```

### "Path escapes workspace root" error

**Symptom:** Error when trying to access a file

**Cause:** Path contains `../` or absolute path that's outside workspace

**Solution:** Use relative paths within workspace:
```typescript
// ✅ Good
path: 'src/subfolder/file.ts'

// ❌ Bad
path: '../outside/file.ts'
path: '/absolute/path/file.ts'
```

### "Workspace root not set" error

**Symptom:** Server fails to start or tools fail

**Cause:** Server not initialized with workspace root

**Solution (Extension):** Pass workspace root to `startServer()`:
```typescript
await startServer(config, workspaceRoot);
```

**Solution (Standalone):** Set environment variable:
```bash
export LLMEM_WORKSPACE=/path/to/workspace
```

### No logs appearing

**Symptom:** Can't see MCP request/response logs

**Cause:** Logs go to stderr, not stdout

**Solution:** Redirect stderr or use `2>&1`:
```bash
node dist/mcp/server.js 2>&1 | tee mcp.log
```

---

## Security Considerations

1. **Path Validation**
   - All paths validated before file operations
   - Directory traversal attacks prevented
   - Paths must stay within workspace

2. **Sensitive Data Redaction**
   - Observer redacts sensitive fields (tokens, passwords, secrets)
   - Logged parameters are safe to store

3. **Workspace Isolation**
   - Server can only access files within workspace
   - No access to parent directories or arbitrary paths
   - Explicit workspace boundary enforcement

4. **Input Validation**
   - Zod schemas validate all tool inputs
   - Type safety enforced
   - Invalid inputs rejected early

---

## References

- [MCP Specification](https://modelcontextprotocol.io/)
- [Best Practices Document](../../../mcp_best_practices.md)
- [Observer Pattern](https://en.wikipedia.org/wiki/Observer_pattern)
- [Path Traversal Prevention](https://owasp.org/www-community/attacks/Path_Traversal)
