# Claude Code Integration

The `claude/` module provides LLMem integration for Claude Code as a standalone CLI plugin with a live-reloading graph server.

## File Structure

```
src/claude/
├── index.ts            # MCP server entry point for Claude Code
├── cli.ts              # CLI commands: serve, generate, stats, mcp
├── config.ts           # Claude-specific configuration
├── server.ts           # Re-exports from server/
├── web-launcher.ts     # Graph generation utilities
└── server/
    ├── index.ts        # GraphServer main class
    ├── http-handler.ts # HTTP request handling
    ├── websocket.ts    # WebSocket for live reload
    ├── file-watcher.ts # Watch source files for changes
    ├── arch-watcher.ts # Watch .arch/ for documentation updates
    └── watch-manager.ts # Manage watched files state
```

## Entry Points

### MCP Server (`index.ts`)

Standalone MCP server for Claude Code integration.

```typescript
// Usage in Claude Code config (~/.config/claude/config.json):
{
  "mcpServers": {
    "llmem": {
      "command": "node",
      "args": ["/path/to/llmem/dist/claude/index.js"]
    }
  }
}
```

Features:
- Auto-detects workspace root (walks up looking for `.git`, `package.json`, etc.)
- Supports `LLMEM_WORKSPACE` environment variable for explicit workspace
- Reuses shared MCP server implementation from `src/mcp/`

### CLI (`cli.ts`)

Command-line interface for graph server and utilities.

```bash
npm run serve              # Start server (default)
npm run serve -- --port 8080
npm run serve -- generate  # Generate graph without serving
npm run serve -- stats     # Show graph statistics
npm run serve -- mcp       # Start MCP server (stdio)
```

**Commands:**
- `serve` — Start HTTP server with live reload (default)
- `generate` — Generate graph without starting server
- `stats` — Show graph statistics
- `mcp` — Start MCP server for Claude Code

**Options:**
- `--port, -p` — Port number (default: 3000)
- `--workspace, -w` — Workspace root (auto-detected)
- `--regenerate, -r` — Force regenerate graph
- `--open, -o` — Open browser automatically
- `--verbose, -v` — Verbose logging

## Graph Server (`server/`)

HTTP server with WebSocket live reload and file watching.

### GraphServer (`server/index.ts`)

Main orchestrator class that coordinates all services.

```typescript
interface ServerConfig {
    port?: number;           // Default: 3000
    workspaceRoot: string;
    artifactRoot?: string;   // Default: '.artifacts'
    openBrowser?: boolean;
    verbose?: boolean;
}

class GraphServer {
    start(): Promise<void>
    stop(): Promise<void>
}
```

### Services

**HttpRequestHandler** (`http-handler.ts`)
- Serves static files from `.artifacts/webview/`
- Handles MIME types for HTML, JS, CSS, JSON

**WebSocketService** (`websocket.ts`)
- WebSocket server for live reload
- Broadcasts `reload` messages when graph changes
- Handles client connections and heartbeats

**FileWatcherService** (`file-watcher.ts`)
- Watches source files for changes using chokidar
- Triggers graph regeneration on file changes
- Debounces rapid changes

**ArchWatcherService** (`arch-watcher.ts`)
- Watches `.arch/` directory for documentation changes
- Notifies webview when design docs are updated
- Sends file-specific update events

**WatchManager** (`watch-manager.ts`)
- Manages which files are "watched" for edge computation
- Handles toggle requests from webview
- Persists state to `.artifacts/worktree-state.json`

## Web Launcher (`web-launcher.ts`)

Utilities for graph generation outside the server context.

```typescript
function hasEdgeLists(workspace: string): boolean
function generateGraph(options: GenerateOptions): Promise<GenerateResult>
function getGraphStats(workspace: string): Promise<GraphStats>
```

## Live Reload Flow

```
1. Source file changes → FileWatcherService detects
2. FileWatcherService triggers regeneration
3. GraphServer regenerates webview
4. WebSocketService broadcasts "reload"
5. Browser receives message, refreshes page
```

## Configuration (`config.ts`)

Claude-specific defaults (same structure as VS Code config).

```typescript
function getClaudeConfig(): Config {
    return {
        artifactRoot: '.artifacts',
        maxFilesPerFolder: 20,
        maxFileSizeKB: 512,
    };
}
```
