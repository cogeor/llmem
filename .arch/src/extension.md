# Extension Module

The extension module provides VS Code/Antigravity IDE integration for LLMem.

## File Structure

```
src/extension/
├── extension.ts    # Extension entry point and lifecycle
├── config.ts       # Configuration management
├── panel.ts        # Webview panel for graph visualization
└── hot-reload.ts   # Watch .artifacts/ for live updates
```

## Extension Lifecycle (`extension.ts`)

Entry point for the VS Code extension.

```typescript
export function activate(context: vscode.ExtensionContext): void
export function deactivate(): void
```

**Activation:**
1. Load configuration from `config.ts`
2. Store workspace root in extension context
3. Register commands (`llmem.showStatus`, `llmem.openPanel`)
4. Start MCP server (stdio transport)

**Commands:**
- `LLMem: Show Status` — Display extension status
- `LLMem: Open Panel` — Open the graph visualization webview

## Configuration (`config.ts`)

Manages extension settings.

```typescript
interface Config {
    artifactRoot: string;       // Default: '.artifacts'
    maxFilesPerFolder: number;  // Default: 20
    maxFileSizeKB: number;      // Default: 512
}

function loadConfig(): Config
function getConfig(): Config
```

Configuration sources (priority order):
1. VS Code settings
2. Environment variables
3. Default values

## Webview Panel (`panel.ts`)

Interactive graph visualization panel.

```typescript
class LLMemPanel {
    static createOrShow(
        extensionUri: vscode.Uri,
        workspaceRoot: string
    ): void

    dispose(): void
}
```

Features:
- Three-panel layout: file tree, graph, design docs
- WebSocket connection for live updates
- Handles toggle messages from UI
- Manages panel lifecycle (create, reveal, dispose)

**Message Handling:**
```typescript
// Messages from webview
{ type: 'toggle', path: string }      // Toggle file/folder watch state
{ type: 'ready' }                     // Webview ready for data

// Messages to webview
{ type: 'data', payload: GraphData }  // Initial graph data
{ type: 'reload' }                    // Trigger refresh
```

## Hot Reload (`hot-reload.ts`)

Watches `.artifacts/` directory for changes and triggers webview updates.

```typescript
class HotReloadService {
    constructor(
        workspaceRoot: string,
        artifactRoot: string,
        onReload: () => void
    )

    start(): void
    stop(): void
}
```

Watched files:
- `import-edgelist.json` — Triggers graph rebuild
- `call-edgelist.json` — Triggers graph rebuild
- `worktree-state.json` — Triggers UI update

Uses debouncing to avoid rapid consecutive reloads.

## Data Flow

```
1. User opens LLMem panel
   → panel.ts creates webview
   → Loads graph data from edge lists
   → Renders in webview

2. User toggles file in UI
   → Webview sends toggle message
   → panel.ts updates worktree state
   → Triggers edge computation
   → hot-reload.ts detects change
   → Webview refreshes

3. External file change
   → hot-reload.ts detects
   → Sends reload message to webview
   → Webview refreshes graph
```

## Development

Press `F5` in VS Code to launch Extension Development Host.

The extension activates on startup (`onStartupFinished` activation event).
