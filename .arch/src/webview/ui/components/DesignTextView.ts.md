# DesignTextView Component - Design Document

## Overview

Displays design documentation for selected files/folders with view/edit toggle and save functionality.

## Key Features

1. **Dual Mode Display**
   - View mode: Rendered HTML from markdown
   - Edit mode: Raw markdown in textarea with save capability

2. **Real-time Updates**
   - Subscribes to WebSocket events for `.arch` file changes
   - Updates display without page reload when docs change externally

3. **Stale Data Handling**
   - Design docs are initially embedded in static HTML at build time
   - If `.arch` files changed after build, embedded data is stale
   - **Solution:** On-demand fetching from `/api/arch` for missing docs

4. **Save Functionality**
   - Ctrl+S keyboard shortcut
   - Visible Save button (in DesignModeToggle header)
   - Saves to `.arch/{path-without-extension}.md`

## Shadow DOM Architecture

Uses Shadow DOM for style isolation:

```typescript
this.shadow = this.el.attachShadow({ mode: 'open' });
this.shadow.innerHTML = DETAIL_STYLES;
this.container = document.createElement('div');
this.shadow.appendChild(this.container);
```

**Critical:** The textarea is inside the Shadow DOM, not in the light DOM.

## Save Flow

### Current Implementation

```typescript
public triggerSave(): void {
    if (this.renderer && this.currentPath) {
        const textarea = this.container.querySelector('.design-markdown-editor');
        if (textarea) {
            this.handleSave(textarea.value);
        }
    }
}
```

**Issue:** The textarea is rendered by `DesignRender.mount(this.container)` which sets `innerHTML`. The querySelector finds the textarea correctly because it's a direct child of `this.container`.

### Save Path Mapping

```typescript
// Source: src/info/folder.ts
// Saved to: .arch/src/info/folder.ts.md (preserves full path + extension)
```

**Important:** Preserves the full source path including extension, then adds `.md`.

## Real-time Update Handling

```typescript
private handleDesignDocChange(path: string, doc: DesignDoc | null): void {
    if (doc) {
        this.designDocs[path] = doc; // Update cache
    } else {
        delete this.designDocs[path]; // Delete from cache
    }

    // Re-render if currently viewing this doc
    if (this.currentPath) {
        const currentState = this.state.get();
        this.onState(currentState);
    }
}
```

Subscribed via:
```typescript
this.dataProvider.onDesignDocChange((path, doc) => {
    this.handleDesignDocChange(path, doc);
});
```

## Cache Key Mapping

Design docs use specific key formats:

- **Files:** `src/info/folder.ts.html` (path without extension + `.html`)
- **Directories:** `src/graph/README.html` (directory path + `/README.html`)

This matches the format used by `DesignDocManager` when generating the initial cache.

## Bug Fixes

### Save Path Calculation Bug (FIXED)

**Problem:** Clicking save appeared to "clear" the file - edits were not persisted.

**Root Cause:** Path calculation in `handleSave()` was removing the file extension:
```typescript
// WRONG - removed extension
let archPath = this.currentPath; // "src/info/folder.ts"
const lastDotIndex = archPath.lastIndexOf('.');
if (lastDotIndex > 0) {
    archPath = archPath.substring(0, lastDotIndex); // "src/info/folder"
}
archPath = `${archPath}.md`; // "src/info/folder.md" ❌
```

This caused saves to go to the wrong file (`folder.md` instead of `folder.ts.md`).

**Fix:** Preserve full source path including extension:
```typescript
// CORRECT - preserves extension
let archPath = `${this.currentPath}.md`; // "src/info/folder.ts.md" ✅
```

**Impact:** Now saves correctly to `.arch/{full-source-path}.md` matching the cache key format.
