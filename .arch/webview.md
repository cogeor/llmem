
# Webview Design Document

## 1. Context and purpose

This document specifies a **single-page webview** (HTML/CSS/JS) for an existing application.

The webview’s role is to:

* Display a **project folder structure** (from `worktree.json`) on the **right side**, in the same style and interaction pattern as standard editors.
* Display, on the **left side**, either:

  * A **borderless text window** showing a selected item’s design/purpose (stored in `.arch/.../*.txt`), or
  * A **graph view** based on `graph_data.json`, filtered according to the selection.
* Provide a **view switch** (Design ⇄ Graph) and, **inside Graph view**, allow switching between **Import Graph** and **Call Graph** for any file selection.

This webview must follow **HTML/CSS/JS best practices**, use **semantic HTML**, split JS into **separate components**, and behave like an SPA: **only one page**, with `router.js` handling view switching.

Note: webview design texts are in webview/arch and already html. Use them as-is.

---

## 2. Requirements (including everything from prior doc, updated)

### 2.1 Folder tree explorer (right side)

* Show a project folder structure from `worktree.json` on the right side.
* Must behave like standard editors:

  * Expand/collapse directories
  * Indentation by depth
  * Distinct file vs folder rows
  * Selection highlight
* Clicking **files or folders** selects them.

### 2.2 Design files (.arch mapping) and text display (left side)

* The user can click **folders and files** to see their purpose.
* Purposes are stored in `.arch` as text files.
* Mapping rule:

  * For `parser/control/main.py` → `.arch/parser/control/main.txt`
* Files may or may not exist:

  * If missing: show **“There is no design file.”**
* On click, show the design file in the left pane in a **borderless text window**.

### 2.3 View switching

#### 2.3.1 Design view ↔ Graph view

* A button toggles the left pane between:

  * **Design Script** (text) and
  * **Graph view**

#### 2.3.2 Graph selection + graph switching (revised)

* `graph_data.json` contains:

  * `importGraph`
  * `callGraph`
* **Revision:** *Both graphs have files as nodes*.
* **Revision:** When a **file** is selected, the user can switch between **importGraph** and **callGraph** at any time (a graph-type toggle inside graph view).

### 2.4 Graph filtering rules (revised)

#### 2.4.1 When a file is selected

* Use the graph type currently chosen in the graph UI: **importGraph** or **callGraph**.
* Filter to **1-hop neighborhood** around the selected file node:

  * Show the selected node
  * Show all nodes directly connected to it
  * Show only those edges

#### 2.4.2 When a folder is selected (important revision)

When selecting folders:

* Determine the set **F** = all **file paths** contained within that folder and all its subfolders (recursive).
* In graph view (either importGraph or callGraph, as chosen by user):

  * Show nodes for:

    1. all files in **F**, and
    2. **their first neighbors in the graph** (one hop from any file in F)
  * Show edges that are relevant to that visible node set.

This produces a “folder scope” view:

* It includes all files *in the subtree*,
* plus the **immediate boundary** nodes outside the subtree that connect to it.

### 2.5 SPA-like behavior + structure

* One page.
* `router.js` switches the left pane between Design and Graph views (no reload).
* JS split into components:

  * Worktree
  * Graph/text view switch
  * Graph view
  * Text view
  * (plus services + filtering utilities)

### 2.6 Best practices

* Semantic HTML: `<main>`, `<aside>`, `<section>`, `<header>`, `<nav>`, etc.
* CSS: flex/grid layout, consistent spacing, accessible focus states, no inline layout styling, component-oriented class naming.
* JS: ES modules, minimal global state, event delegation where appropriate, explicit state store.

---

## 3. Data formats

### 3.1 `worktree.json` (confirmed schema excerpt)

Example (your excerpt):

```json
{
  "name": "src",
  "path": "src",
  "type": "directory",
  "size": 0,
  "children": [
    {
      "name": "artifact",
      "path": "src/artifact",
      "type": "directory",
      "size": 0,
      "children": [
        {
          "name": "index.ts",
          "path": "src/artifact/index.ts",
          "type": "file",
          "size": 2142
        }
      ]
    }
  ]
}
```

Key points:

* Each node has: `name`, `path`, `type` (`directory` | `file`), optional `children`.
* Selection IDs in the UI should use `path` as the canonical identifier.

### 3.2 `.arch` design docs

Mapping from a selected worktree `path`:

* File: `src/artifact/index.ts` → `.arch/src/artifact/index.txt`
* Directory: `src/artifact` → `.arch/src/artifact.txt`

(Directory mapping is implied by “folders and files” are clickable and share a mapping; if your `.arch` omits directory docs, missing-file behavior covers it.)

### 3.3 `graph_data.json`

* Contains `importGraph` and `callGraph`.
* **Revised assumption:** both graphs use **file paths** as `nodes[].id` (or at least something that can be mapped from worktree file paths).

---

## 4. UI design

### 4.1 Layout

Two panes:

* Left: detail area with top controls
* Right: worktree explorer

Left top controls:

* Primary toggle: **Design Script** | **Graph view**
* When Graph view is active: secondary toggle: **Import graph** | **Call graph**

### 4.2 Design text window

* Borderless look
* `pre` or `div` with `white-space: pre-wrap;`
* Scrollable
* Empty state if nothing selected

### 4.3 Graph view behavior

* Empty state if nothing selected
* When file selected: show 1-hop neighborhood
* When folder selected: show subtree files + their first neighbors (union of one-hop neighbors for all subtree files)

---

## 5. Architecture

### 5.1 Module layout

```
webview/
  index.html
  styles/
    base.css
    layout.css
    tree.css
    detail.css
    graph.css
  js/
    main.js
    router.js
    state.js
    services/
      worktreeService.js
      designDocService.js
      graphDataService.js
    components/
      Worktree.js
      ViewToggle.js          // Design vs Graph
      GraphTypeToggle.js     // Import vs Call
      DesignTextView.js
      GraphView.js
    graph/
      GraphFilter.js         // filtering algorithms
      GraphRendererAdapter.js
```

### 5.2 State model (single source of truth)

State fields (minimum):

* `currentView`: `"design"` | `"graph"`
* `graphType`: `"import"` | `"call"` (only meaningful in graph view)
* `selectedPath`: string | null
* `selectedType`: `"file"` | `"directory"` | null
* `expandedFolders`: `Set<string>`

Derived data (computed on demand):

* `selectedSubtreeFiles`: `Set<string>` when selectedType is directory
* `graphSelectionScope`: set of visible nodes based on rules

---

## 6. Key algorithms

### 6.1 Collect files in a directory subtree

Given a selected directory node from `worktree.json`, recursively collect all descendant nodes where `type === "file"`, returning their `path`.

### 6.2 Graph filtering

Let `G` be the currently chosen graph (import or call).

#### File selection:

* Visible nodes = `{S} ∪ neighbors(S)`
* Visible edges = edges incident to `S` within those nodes

#### Folder selection:

* Let `F` = all file paths in folder subtree
* Compute `N(F)` = union of neighbors for each file in `F`
* Visible nodes = `F ∪ N(F)`
* Visible edges = edges where both endpoints are visible (or, stricter, only edges that connect to F; choose based on clarity—see snippet section)

---

# 2) Code snippets for the most important parts

## 2.1 State additions: `graphType`

```js
// js/state.js initial state example
export const initialState = {
  currentView: "design",
  graphType: "import", // "import" | "call"
  selectedPath: null,
  selectedType: null,  // "file" | "directory"
  expandedFolders: new Set(),
};
```

## 2.2 Graph type toggle component (`GraphTypeToggle.js`)

Choice point: only show when `currentView === "graph"`.

```js
// js/components/GraphTypeToggle.js
export class GraphTypeToggle {
  constructor({ el, state }) {
    this.el = el;
    this.state = state;
  }

  mount() {
    this.el.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-graph-type]");
      if (!btn) return;
      this.state.set({ graphType: btn.dataset.graphType }); // "import" | "call"
    });

    this.unsubscribe = this.state.subscribe((s) => this.render(s));
  }

  render({ currentView, graphType }) {
    if (currentView !== "graph") {
      this.el.innerHTML = "";
      return;
    }

    this.el.innerHTML = `
      <div class="segmented" role="group" aria-label="Graph type">
        <button data-graph-type="import" class="${graphType === "import" ? "is-active" : ""}">Import graph</button>
        <button data-graph-type="call" class="${graphType === "call" ? "is-active" : ""}">Call graph</button>
      </div>
    `;
  }

  unmount() { this.unsubscribe?.(); }
}
```

## 2.3 Worktree selection uses `path` and `type` exactly as in JSON

This matters because your worktree nodes already contain canonical `path`.

```js
// inside Worktree click handling
this.state.set({
  selectedPath: item.path,          // e.g. "src/artifact/index.ts"
  selectedType: item.type,          // "file" | "directory"
});
```

## 2.4 Subtree file collection utility (folder selection)

```js
// js/services/worktreeService.js (or a util module)
export function collectSubtreeFiles(dirNode) {
  const files = new Set();

  function walk(node) {
    if (!node) return;
    if (node.type === "file") {
      files.add(node.path);
      return;
    }
    if (node.type === "directory" && Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  }

  walk(dirNode);
  return files;
}
```

## 2.5 Graph filtering: file selection (1-hop)

```js
// js/graph/GraphFilter.js
export function filterOneHopFromNode(graph, selectedId) {
  const edges = graph.edges ?? [];
  const nodes = graph.nodes ?? [];

  const visible = new Set([selectedId]);
  for (const e of edges) {
    if (e.from === selectedId) visible.add(e.to);
    if (e.to === selectedId) visible.add(e.from);
  }

  return {
    nodes: nodes.filter(n => visible.has(n.id)),
    edges: edges.filter(e =>
      (e.from === selectedId && visible.has(e.to)) ||
      (e.to === selectedId && visible.has(e.from))
    ),
  };
}
```

## 2.6 Graph filtering: folder selection (subtree files + first neighbors)

This is the main revised requirement.

**Important choice:** edges to display.

* Option A (clean): show **all edges among visible nodes**.
* Option B (scope-focused): show only edges where **at least one endpoint is in F** (keeps attention on the folder’s files).

Below is **Option B**, which matches “folder in/out edges” intent more closely.

```js
// js/graph/GraphFilter.js
export function filterFolderScope(graph, subtreeFilesSet) {
  const edges = graph.edges ?? [];
  const nodes = graph.nodes ?? [];

  // 1) neighbors of any subtree file
  const visible = new Set(subtreeFilesSet);

  for (const e of edges) {
    if (subtreeFilesSet.has(e.from)) visible.add(e.to);
    if (subtreeFilesSet.has(e.to)) visible.add(e.from);
  }

  // 2) nodes limited to visible
  const filteredNodes = nodes.filter(n => visible.has(n.id));

  // 3) edges limited to "within 1 neighbor" of subtree:
  // keep edges that connect a subtree file to a visible node
  const filteredEdges = edges.filter(e =>
    (subtreeFilesSet.has(e.from) && visible.has(e.to)) ||
    (subtreeFilesSet.has(e.to) && visible.has(e.from))
  );

  return { nodes: filteredNodes, edges: filteredEdges };
}
```

## 2.7 GraphView: choose graph by `graphType`, then choose filter by selection type

```js
// js/components/GraphView.js
import { filterOneHopFromNode, filterFolderScope } from "../graph/GraphFilter.js";

export class GraphView {
  constructor({ el, state, graphDataService, worktreeIndex, graphRenderer }) {
    this.el = el;
    this.state = state;
    this.graphDataService = graphDataService;
    this.worktreeIndex = worktreeIndex; // path -> node, so we can find dir node by selectedPath
    this.graphRenderer = graphRenderer;
  }

  async mount() {
    this.graphData = await this.graphDataService.load();
    this.unsubscribe = this.state.subscribe((s) => this.onState(s));
  }

  onState({ currentView, graphType, selectedPath, selectedType }) {
    if (currentView !== "graph") return;

    if (!selectedPath) {
      this.el.innerHTML = `<p class="empty">Select a file or folder to see graph connections.</p>`;
      return;
    }

    const graph = graphType === "import"
      ? this.graphData.importGraph
      : this.graphData.callGraph;

    let filtered;

    if (selectedType === "file") {
      filtered = filterOneHopFromNode(graph, selectedPath);
    } else {
      const dirNode = this.worktreeIndex.get(selectedPath);
      const subtreeFiles = collectSubtreeFiles(dirNode); // import from service/util
      filtered = filterFolderScope(graph, subtreeFiles);
    }

    this.el.innerHTML = `<div class="graph-canvas" aria-label="Graph view"></div>`;
    this.graphRenderer.render(this.el.querySelector(".graph-canvas"), filtered, {
      selectedId: selectedType === "file" ? selectedPath : null
    });
  }

  unmount() { this.unsubscribe?.(); }
}
```

