# Folder View

Status: design sketch.
Owners: domain/folder-tree, application/getViewerData, apps/web-viewer.

## Problem

The current left panel is a checkbox list of files keyed off "watched" state. The graph itself is the navigator. That works when a repo has 50 files; it falls apart at 5,000. Users open LLMem, see a hairball, can't find the folder they care about, and bounce.

A real folder view should be the primary navigator and the graph should be the secondary, contextual surface.

## Goals

1. Open a 10k-file repo and see the top-level folders in under 100ms — no wait for the graph.
2. Drill into any folder and immediately see what's inside, regardless of the graph state.
3. Cross-link to the graph: clicking a folder filters the graph to its members; selecting a graph node scrolls the tree to it.
4. Make watched/unwatched state, doc presence, and "this folder has a spec linked to it" (see design/03) discoverable at a glance.

## Non-goals

- Replacing IDE file explorers. We do not ship search-across-content, rename, etc.
- Visualizing the full filesystem. We restrict to files our parsers know about, plus folders that contain them.

## Shape

### Tree primitives

`packages/domain/folder-tree.ts` exposes:

```ts
interface FolderNode {
  path: RelPath;          // "" for root
  name: string;
  children: FolderNode[];
  files: FileRef[];
  stats: FolderStats;
}

interface FolderStats {
  fileCount: number;
  totalLOC: number;
  watchedFileCount: number;
  documentedFileCount: number;        // has .arch/{path}.md
  specLinkedFileCount: number;        // see design/03
  importEdgesIn: number;              // edges from outside this subtree → inside
  importEdgesOut: number;
  importEdgesInternal: number;
}

interface FileRef {
  path: RelPath;
  language: LanguageId;
  loc: number;
  watched: boolean;
  documented: boolean;
  specLinked: boolean;
}
```

The tree is built once per scan and cached as `.artifacts/folder-tree.json`. Watch updates patch single nodes.

### UI shape (apps/web-viewer)

The left panel is a virtualized tree:

```
▾ src/                                 [142 files · 8 watched · 2 documented]
  ▸ packages/                          [98 files · 0 watched]
  ▸ apps/                              [12 files · 8 watched · 2 documented]
    ▸ cli/                             [4 files · 4 watched · 1 documented]
      ● cli.ts            ts · 312 loc · ◉ watched · ✎ documented · § linked
      ● commands/         …
```

Glyphs (legend pinned to the panel header):

- ◉ watched · ◌ unwatched
- ✎ has `.arch/{path}.md`
- § linked from a spec (design/03)
- ⚠ extraction failed for this file — click for log

Per-folder summary on hover: file count, LOC total, "12 imports out of subtree, 4 imports in" so the user can spot self-contained packages instantly.

### Cross-linking with the graph

- Selecting a folder in the tree filters the graph to the union of its files **plus their direct neighbors**. The neighbors render at reduced opacity; the in-folder nodes are full.
- Selecting a node in the graph scrolls the tree to its file and highlights it. Folders along the path expand.
- Right-click a folder → "Open as the graph root" — the graph rebuilds with that folder as the universe (everything outside drops to a single "external" node per package). Useful for big repos.

### Folder-level docs

A folder's `.arch/{path}/README.md` (already produced by `report_folder_info`) is rendered in the **right panel** when the folder is selected. Same renderer the file-level design docs use today. This is what currently happens for files; folders just inherit the same UX.

## Performance budget

- Tree build (10k files): < 250ms server-side, included in initial scan.
- Tree render (10k files): virtualized, only the expanded subset is in the DOM. < 16ms per scroll frame.
- Folder selection → graph filter: < 100ms even on the largest expected repo.

The tree primitive is plain data — no graph computation. Filtering the graph to a folder is a set membership check, not a re-traversal.

## API contract (HTTP server → web viewer)

`viewer-shared` defines:

```ts
GET /api/folder-tree           → FolderTree         // full tree, cached
GET /api/folder/:path          → FolderDetails      // stats + files + loaded README
POST /api/folder/:path/select  → { focusGraphIds }  // server tells client which graph nodes to highlight
```

All responses are Zod-validated at the boundary. No raw fetch in components — only the typed feature module under `apps/web-viewer/src/features/folder-tree/api.ts`.

## Open questions

- How do we handle monorepos with many top-level folders? Probably collapse to one summary line per top-level until the user expands. Test against a real monorepo before deciding.
- Sort order: alphabetical? By LOC? By import-fan-in? Default alphabetical, surface a sort selector — nothing automatic that surprises the user.
- Search-in-tree: out of scope for v1. Browser Ctrl-F is good enough for now.

## Revision: additive package-overview page

Supersedes the framing above. The existing graph + file-list UI stays as-is; this is a new surface alongside it, not a replacement.

### What it is

A separate single-page web view showing the folder/package structure laid out horizontally. Higher-level than the existing graph: the existing view answers "what calls what at function level"; this one answers "what does the codebase look like at the package level, and how do the packages connect?"

### Shape

- Horizontal layout: root on the left, children fanning right. Either an indented sideways tree or Miller-columns (one column per depth) — prototype both on a real 5k-file repo before committing.
- Each folder renders as a card: name, file count, language mix as a thin colored strip, glyphs for documented / spec-linked / watched.
- Click a folder → right-side panel opens with that folder's `.arch/{path}/README.md` (the existing `report_folder_info` output, no new generator needed).
- Folder-to-folder connections overlay as arcs: aggregated import/call edges between subtrees. Visually distinct from tree-parent edges so they don't read as hierarchy.

### Folder-edge rollup (new primitive)

The bit that makes this "higher tier." Roll file-level edges up to folder granularity:

```ts
interface FolderEdge {
  from: RelPath;          // folder, not file
  to: RelPath;
  kind: 'import' | 'call';
  weight: number;         // count of underlying file/function edges
}
```

`packages/domain/folder-edges.ts` consumes the existing `import-edgelist.json` / `call-edgelist.json` and emits `folder-edgelist.json`. Cached per scan; updated on the same dirty-flag cycle as file edges. Pure aggregation — no new parser work.

User sees `parser → graph` (weight 47) instead of 47 individual file edges. That's the whole point.

### Density / interaction

- Default: show only folder edges above a per-scan top-N threshold; everything else hidden until the user asks. Hairballs are the failure mode to avoid.
- Hover a folder → highlight only its in/out edges; rest fade.
- Click an edge → list the underlying file edges that compose it. That's the bridge back to the existing graph view for drill-down.
- "Pin" a folder to keep it visible while exploring others.

### Cross-linking with the existing graph view

- From the existing graph: right-click a node → "show in package overview" — opens this page focused on the file's folder.
- From this page: click a file inside a folder panel → "show in graph view" — opens the existing view scoped to that file.

The two views share the edge list; only the rollup is new computation.

### Carried over from the original sketch above

- The `FolderNode` / `FolderStats` primitive is still the right shape, used here for the cards.
- Performance budget still applies; rollup runs at scan time.
- API contract gains `GET /api/folder-edges` for the rollup. The original `GET /api/folder-tree` and `GET /api/folder/:path` are reused.

### Open questions

- Horizontal indented tree vs. Miller columns — needs a prototype bake-off, not an a-priori pick.
- How wide is the page allowed to get? Real repos go 6+ levels deep. Likely horizontal scroll for the tree area, fixed-width description panel.
- Edge bundling: when 4 sibling folders import the same cousin, draw 4 edges or 1 bundled edge weight 4? Default to bundling; give a toggle.
- Should this view ever show file-level nodes, or strictly folders? Strictly folders keeps the "higher tier" promise; mixing levels reintroduces the density problem the existing graph already has.

## Implementation plan

This section is concrete enough to act on. It assumes the repo layout as of commit `e6f806e` — `src/claude/`, `src/graph/`, `src/webview/` etc. The cross-cutting `apps/`/`packages/` layout from `MIGRATION.md` is **not** a prerequisite; this plan lands inside the current `src/` tree.

### Current code state (load-bearing facts)

- **Edge lists**: `.artifacts/import-edgelist.json` and `.artifacts/call-edgelist.json` are persisted by `ImportEdgeListStore` / `CallEdgeListStore` (`src/graph/edgelist.ts` + Zod schema in `src/graph/edgelist-schema.ts`, `schemaVersion: 1`). Loaded via `migrate(raw, filePath)` so the migrator is the only place the schema can change.
- **Scan flow**: `src/application/scan.ts` exposes `scanFile`, `scanFolder`, `scanFolderRecursive`. They take a `WorkspaceIO` (realpath-strong containment) and append to the edge-list stores. This is the canonical scan entry — both the CLI and the HTTP server call it.
- **Static webview generation**: `src/webview/generator.ts` is invoked by `src/claude/web-launcher.ts:generateGraph` and writes `.artifacts/webview/{index.html, graph_data.js, work_tree.js, design_docs.js, js/main.js, ...}`. Three globals are injected: `window.GRAPH_DATA`, `window.WORK_TREE`, `window.DESIGN_DOCS`.
- **HTTP server**: `src/claude/server/index.ts` (re-exported as `src/claude/server.ts`). Runs on port 3000, has a registry of API routes (`src/claude/server/routes/index.ts:registerRoutes`), a file watcher, an arch watcher, a regenerator (`src/claude/server/regenerator.ts`), and a WebSocket live-reload bus (`src/claude/server/websocket.ts`). On any source change, the regenerator rescans and re-emits the static webview.
- **Webview UI**: `src/webview/ui/main.ts` bootstraps two routes via `src/webview/ui/router.ts`: `'graph'` (`GraphView`) and `'design'` (`DesignTextView`). Both consume `DataProvider` (`src/webview/ui/services/dataProvider.ts`). Two implementations: `StaticDataProvider` (reads `window.*`) and `VSCodeDataProvider` (postMessage). Routes are toggled via the existing header buttons in `index.html`.
- **Folder docs already exist**: `.arch/{folder}/README.md` is generated today by `src/application/document-folder.ts:processFolderInfoReport`. The webview already loads them via `dataProvider.loadDesignDocs()` and keys them by `getDesignDocKey` (`src/docs/arch-store.ts`) — `.arch/src/parser/README.md` resolves to the key `src/parser/README.md`.
- **What's missing for this view**: no folder-level edge aggregation, no folder-tree primitive, no `/packages` route, no in-viewer folder card UI.

### Target state

A `'packages'` route in the existing webview, served by the existing HTTP server (and by the existing static-webview path). Three new artifacts under `.artifacts/`:

```
.artifacts/
  import-edgelist.json     # existing
  call-edgelist.json       # existing
  folder-tree.json         # NEW
  folder-edgelist.json     # NEW
  webview/
    folder_tree.js         # NEW (window.FOLDER_TREE = ...)
    folder_edges.js        # NEW (window.FOLDER_EDGES = ...)
```

The view reads these plus `dataProvider.loadDesignDocs()` (existing) for descriptions.

### New domain primitives

**`src/graph/folder-tree.ts`** — pure aggregation, no I/O.

```ts
export const FolderNodeSchema: z.ZodType<FolderNode> = z.lazy(() => z.object({
    path: z.string(),               // RelPath, "" for root
    name: z.string(),
    children: z.array(FolderNodeSchema),
    fileNames: z.array(z.string()), // files directly inside this folder
    fileCount: z.number(),          // recursive
    totalLOC: z.number(),           // recursive
    documented: z.boolean(),        // .arch/{path}/README.md exists
}));

export const FolderTreeSchema = z.object({
    schemaVersion: z.literal(1),
    timestamp: z.string(),
    root: FolderNodeSchema,
});

export type FolderTreeData = z.infer<typeof FolderTreeSchema>;

export function buildFolderTree(input: {
    importNodes: NodeEntry[];          // from ImportEdgeListStore.getNodes()
    documentedFolders: Set<string>;    // from a single .arch walk at scan-time
    locByFile?: Map<string, number>;   // optional; if absent, totalLOC is 0
}): FolderTreeData;
```

The tree is derived from the file IDs already present in `import-edgelist.json` (every file gets at least a node, even in lazy mode — see `application/scan.ts` and `application/viewer-data.ts:scanAndPopulateSplitEdgeLists`). No new walking of the source tree is needed for v1.

**`src/graph/folder-edges.ts`** — pure aggregation, no I/O.

```ts
export const FolderEdgeSchema = z.object({
    from: z.string(),
    to: z.string(),
    kind: z.enum(['import', 'call']),
    weight: z.number().int().positive(),
});

export const FolderEdgelistSchema = z.object({
    schemaVersion: z.literal(1),
    timestamp: z.string(),
    edges: z.array(FolderEdgeSchema),
    /** Threshold below which the viewer should hide edges by default. */
    weightP90: z.number(),
});

export type FolderEdgelistData = z.infer<typeof FolderEdgelistSchema>;

export function buildFolderEdges(input: {
    importEdges: EdgeEntry[];
    callEdges: EdgeEntry[];
    /** Resolves entity IDs to their fileId. Pull from edge-list nodes. */
    fileOf: (id: string) => string | null;
}): FolderEdgelistData;
```

**Aggregation rules**:

1. For each edge, resolve `source` and `target` to file IDs via `fileOf` (entity IDs in `call-edgelist.json` already store `fileId` on the node; build a `Map<id, fileId>` at start).
2. Drop edges where `source` or `target` is external (`isExternalModuleId` from `src/core/ids.ts`).
3. Compute `folderOf(fileId) = path.dirname(fileId).replaceAll('\\', '/')`. Top-level files → `'.'`.
4. Drop self-edges (same source and target folder) — internal cohesion belongs in `FolderNode.fileCount`, not in edges.
5. Bucket by `(fromFolder, toFolder, kind)`; weight is the count.
6. Compute the 90th-percentile weight; persist as `weightP90`. The viewer hides edges below this by default.

Roll-up to ancestor folders (when the user collapses a subtree) is **on-the-fly** in the viewer — the persisted form is leaf-folder-to-leaf-folder.

**Stores** (mirror the existing pattern in `src/graph/edgelist.ts`):

```ts
// src/graph/folder-tree-store.ts
export class FolderTreeStore {
    constructor(private artifactDir: string, private io?: WorkspaceIO);
    async load(): Promise<FolderTreeData>;
    async save(data: FolderTreeData): Promise<void>;
}

// src/graph/folder-edges-store.ts
export class FolderEdgelistStore { /* same shape */ }
```

The stores parse via Zod and use `WorkspaceIO` for realpath-strong I/O, exactly like `BaseEdgeListStore`.

### Wiring into the existing scan and serve flows

**`src/claude/server/regenerator.ts`** — augment `regenerateWebview` and `rescanSourcesAndRegenerate` to call the new aggregators after the existing edge-list save. The diff is roughly:

```ts
// after importStore.save() / callStore.save():
const documentedFolders = await scanArchFolders(io); // walks .arch/ once
const fileOf = buildFileOfMap(importStore, callStore);

const folderTree = buildFolderTree({
    importNodes: importStore.getNodes(),
    documentedFolders,
});
const folderEdges = buildFolderEdges({
    importEdges: importStore.getEdges(),
    callEdges: callStore.getEdges(),
    fileOf: (id) => fileOf.get(id) ?? null,
});

await new FolderTreeStore(artifactDir, io).save(folderTree);
await new FolderEdgelistStore(artifactDir, io).save(folderEdges);
```

Then `generateStaticWebview` (next).

**`src/webview/generator.ts`** — emit two new globals, mirroring the existing `graph_data.js` block. After step 5 ("Read and Template HTML"), before step 6 ("Bundle Design Docs"):

```ts
// 5b. Folder tree + folder edges
const folderTreePath = path.join(destinationDir, 'folder_tree.js');
fs.writeFileSync(
    folderTreePath,
    `window.FOLDER_TREE = ${JSON.stringify(folderTree)};`,
    'utf8',
);
const folderEdgesPath = path.join(destinationDir, 'folder_edges.js');
fs.writeFileSync(
    folderEdgesPath,
    `window.FOLDER_EDGES = ${JSON.stringify(folderEdges)};`,
    'utf8',
);
```

The HTML injection block (the `htmlContent.replace(...)` near the end) gains:

```html
<script src="folder_tree.js"></script>
<script src="folder_edges.js"></script>
```

These scripts must be added before `js/main.js` so the bootstrap can read them synchronously.

**`src/claude/server/routes/folder-tree.ts`** (new) and **`src/claude/server/routes/folder-edges.ts`** (new) — read the corresponding artifact JSONs and respond. Pattern identical to `src/claude/server/routes/stats.ts`. Register both in `src/claude/server/routes/index.ts`:

```ts
ctx.httpHandler.registerApiHandler('/api/folder-tree', (req, res) =>
    handleFolderTreeRoute(req, res, ctx),
);
ctx.httpHandler.registerApiHandler('/api/folder-edges', (req, res) =>
    handleFolderEdgesRoute(req, res, ctx),
);
```

These exist for the live-reload path (`VSCodeDataProvider`-style consumers). The static `StaticDataProvider` reads `window.FOLDER_TREE` / `window.FOLDER_EDGES` and never hits these endpoints.

### DataProvider extensions

**`src/webview/ui/services/dataProvider.ts`** — add:

```ts
loadFolderTree(): Promise<FolderTreeData>;
loadFolderEdges(): Promise<FolderEdgelistData>;
```

Both required (not optional) — every host needs to surface package overview.

**`src/webview/ui/services/staticDataProvider.ts`** — read `window.FOLDER_TREE` / `window.FOLDER_EDGES`. Pattern matches the existing `loadGraphData()` reading `window.GRAPH_DATA`.

**`src/webview/ui/services/vscodeDataProvider.ts`** — postMessage round-trip mirroring `loadGraphData`. The VS Code panel's host-side message handler (in `src/extension/panel.ts` — not yet read in this exploration but follows the pattern) gains two cases that read from `application/viewer-data.ts` extended with a folder-tree+edges getter.

### New webview component

**`src/webview/ui/components/PackageView.ts`** — the entire view, split if it grows past ~200 lines.

Structure:

```
+---------------------------------------------------+----------------+
|  horizontal indented folder tree                  |  description   |
|                                                   |  panel:        |
|  src/                                             |                |
|    └── parser/    [12 files · ✎]    --[47 imp]-> |  rendered      |
|    └── graph/      [7 files · ✎]                  |  .arch/<path>/ |
|    └── webview/   [23 files]        --[12 imp]-> |  README.md     |
|        └── ui/                                                     |
|                                                   |                |
+---------------------------------------------------+----------------+
                                                    |  edge details  |
                                                    |  (when an arc  |
                                                    |   is clicked)  |
                                                    +----------------+
```

- v1 layout: **horizontal indented tree**, root left, children fan right. (Miller-columns is the open question; commit to one for v1, prototype the other if real-repo testing argues for a swap.)
- Each folder is a card showing `name`, `fileCount`, glyphs (`✎` if `documented`).
- Folder edges render as arcs between cards using `vis-network` (already bundled in `.artifacts/webview/libs/`). Default density: hide edges below `weightP90`.
- Click a folder card → `state.set({ selectedFolder: path })` → right-side panel renders `dataProvider.loadDesignDocs()[`${path}/README.md`]` via the existing `DesignRender` helper. If no doc exists, render a placeholder with a CLI suggestion (`llmem document <path>`).
- Click an arc → bottom panel lists the underlying file edges by re-filtering `window.GRAPH_DATA.importGraph.edges` for `folderOf(source) === edge.from && folderOf(target) === edge.to`. Each row links back to the existing `'graph'` route scoped to that file.
- Hover a folder → highlight only its in/out arcs; rest fade.
- Toggle in component header: "Show all edges" (overrides the `weightP90` filter).

### Router and toggle

**`src/webview/ui/main.ts`**:

```ts
const packageView = new PackageView({ el: elPackageView, state, dataProvider });
router.registerRoute('packages', packageView);
mountPromises.push(packageView.mount());
```

Element `#package-view` added to `src/webview/index.html` next to `#design-view` and `#graph-view`.

**`src/webview/ui/state.ts`** — extend the `currentView` union to include `'packages'`.

**View toggle** — extend the existing toggle row at the top of the page (currently just `Design ↔ Graph`) to a tri-state. Component: new `src/webview/ui/components/ViewToggle.ts` (replaces `DesignModeToggle` if it doesn't already cover three states; check the existing one before duplicating).

### Implementation order (cleanest dependency chain)

1. **Domain primitives** — `folder-tree.ts`, `folder-edges.ts`, the two stores, Zod schemas. Pure functions, fully tested with fixtures derived from this repo's `.artifacts/`.
2. **Wire into the server-side regenerator** — `src/claude/server/regenerator.ts` calls the aggregators after each scan, `src/webview/generator.ts` emits the two new globals.
3. **HTTP routes** — `/api/folder-tree`, `/api/folder-edges`. Smoke-test by `curl`.
4. **DataProvider plumbing** — interface + both implementations.
5. **PackageView component** — start with a static placeholder showing the folder tree as a list, no edges. Iterate on layout once data flows end-to-end.
6. **Edges + interaction** — arcs, density, click-through.
7. **Description panel integration** — reuse `DesignRender` from `DesignTextView`.
8. **Toggle button + state route** — last step; gates user discovery.

### User flow (when implemented)

1. User runs `llmem serve` in any repo (per design/06's zero-config CLI).
2. Server auto-scans on first run; emits the two new artifacts to `.artifacts/`; bundles them into `.artifacts/webview/`; opens the browser.
3. Header shows three view toggles: `Graph`, `Design`, `Packages`. User clicks `Packages`.
4. Right side renders the horizontal folder tree of the workspace root. Folders show file counts and `✎` glyphs where `.arch/{path}/README.md` exists. Top-N folder edges render as arcs between the cards.
5. User clicks `src/parser`. Right panel renders `.arch/src/parser/README.md`. If absent, panel says "No design doc yet — run `llmem document src/parser`."
6. User clicks the arc between `src/parser` and `src/graph`. Bottom panel lists the underlying file imports/calls (e.g., `parser/ts-extractor.ts → graph/types.ts`). Each row links to the `'graph'` view scoped to that file.
7. User edits `src/parser/ts-extractor.ts`. Server's file watcher fires → regenerator rescans → emits new edge lists, folder tree, folder edges → WebSocket broadcasts refresh → `PackageView.mount()` re-runs and the arc weight updates without a page reload.

### Test strategy

- `tests/unit/graph/folder-tree.test.ts` — fixture-driven aggregation; assert deterministic output on the LLMem repo's own edge lists.
- `tests/unit/graph/folder-edges.test.ts` — assert internal edges aggregate, self-loops drop, externals drop, weights match. Edge case: file with no folder (top-level) maps to `'.'`.
- `tests/unit/graph/folder-edges-percentile.test.ts` — `weightP90` computation on small/large/uniform distributions.
- `tests/integration/server-folder-routes.test.ts` — boot a `GraphServer` against a fixture workspace, hit `/api/folder-tree` and `/api/folder-edges`, assert payload shapes via Zod.
- `tests/contracts/folder-artifacts-schema.test.ts` — pin the on-disk shape; any schema change requires touching this test.
- Manual: scan this repo, open `/packages`, verify `src/parser` connects to `src/graph` via call edges (it does today via `artifactToEdgeList`), and that clicking the arc surfaces the underlying file edges.

### Out of scope for v1

- Miller-columns alternative layout.
- File-level cards inside folder cards.
- `§` spec-link glyphs (depends on design/03, not yet promoted).
- Cross-link from the `'graph'` route to `'packages'` (right-click → "show in package overview"). Add post-v1.
- Watched/unwatched glyphs at folder level — `'packages'` is intentionally watched-state-agnostic.
- Edge bundling (one bundled arc for sibling folders sharing a target). Default to per-pair arcs; revisit if visual density argues for it.
