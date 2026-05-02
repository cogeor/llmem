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
