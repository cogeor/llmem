# ArchWatcherService - Design Document

## Overview

Dedicated file watcher service for the `.arch` directory. Monitors markdown files and emits incremental WebSocket updates when files are created, modified, or deleted.

**Completely separated from source file watching** - this service only handles design documentation, not code files.

## Key Design Decisions

### Directory Watching vs Glob Patterns

**Critical Implementation Detail:** On Windows, chokidar glob patterns (`**/*.md`) are unreliable when combined with polling mode.

**Solution:** Watch the directory directly and filter for `.md` files in event handlers:

```typescript
// ❌ DON'T: Unreliable on Windows
const watchPattern = path.join(this.archDir, '**/*.md');

// ✅ DO: Watch directory, filter in code
const watchPattern = this.archDir;
this.watcher.on('change', (filePath) => {
    if (filePath.endsWith('.md')) {
        this.handleEvent('updated', filePath);
    }
});
```

**Why this works:**
- Chokidar's directory recursion is more reliable than glob matching on Windows
- Avoids conflicts between polling mode + glob pattern + awaitWriteFinish
- JavaScript filtering is fast and deterministic

### Polling on Windows

```typescript
usePolling: process.platform === 'win32',
interval: 100,
```

Native file system events on Windows can be unreliable. Polling ensures changes are detected at the cost of slightly higher CPU usage.

### Debouncing

File changes are debounced (300ms) to avoid multiple events for rapid successive writes:

```typescript
private debounceDelay = 300; // ms
```

## Event Flow

```
File Change in .arch/
    ↓
Chokidar detects (via polling on Windows)
    ↓
Filter for .md files
    ↓
Debounce (300ms)
    ↓
Read file + Convert markdown to HTML
    ↓
Emit event to GraphServer
    ↓
GraphServer broadcasts via WebSocket
    ↓
Frontend DesignDocCache updates
    ↓
UI re-renders (no page reload)
```

## API

### `setup(onEvent: (event: ArchFileEvent) => void)`

Initializes the watcher. Must be called before files are monitored.

**Important:** Returns immediately but watcher becomes ready asynchronously. Listen for the 'ready' event.

### `readDoc(relativePath: string)`

Reads and converts a markdown file to HTML. Lazy-loads the `marked` module if needed.

### `writeDoc(relativePath: string, markdown: string)`

Writes markdown to `.arch/{relativePath}.md`. Creates parent directories as needed.

### `close()`

Stops watching and cleans up resources.

## Markdown Conversion

Uses `marked` library (ESM module) loaded dynamically:

```typescript
const dynamicImport = new Function('specifier', 'return import(specifier)');
const module = await dynamicImport('marked');
this.marked = module.marked;
```

This works around TypeScript compilation issues with ESM imports in CommonJS modules.

## Error Handling

- Missing marked module: Logs error but continues (HTML will be empty)
- File read errors: Logged and returned as null
- File write errors: Returns false, logged
- Chokidar errors: Logged via 'error' event handler

## Testing

See `src/scripts/test-arch-watcher.ts` for integration tests covering:
- File read/write operations
- Event detection (timing-dependent on Windows)
- API endpoint integration
