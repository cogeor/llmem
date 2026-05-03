# Codebase Quality Implementation Plan

Date: 2026-05-03

Scope: static review of the repository excluding `memo/` during investigation. Tests were not run; assume current tests pass.

Overall grade: B / B+

The codebase has strong direction: TypeScript strict mode, branded path and graph ID contracts, explicit architecture tests, a growing application layer, split edge-list schemas, and host abstraction in the webview. The main quality problem is incomplete migration. Several new contracts exist but are not yet universal, so the system currently has two styles in flight: contract-driven application services and older raw-path / console / hard-coded runtime code.

## Executive Priority Order

1. Finish workspace path safety and real containment across all filesystem entry points.
2. Make artifact root an explicit contract across application, MCP, CLI, server, and extension code.
3. Fix HTTP mutating route method semantics.
4. Move viewer-model generation out of the webview layer.
5. Replace generic import-resolution heuristics with language-owned resolver contracts.
6. Refactor recursive scan to one traversal and one store transaction.
7. Split large webview components and remove remount/listener leaks.
8. Replace edge-list array internals with indexed structures while keeping the persisted schema stable.
9. Retire or migrate legacy `src/test/` and root `test/` scripts.
10. Consolidate duplicated filtering/constants/logging patterns.

## Grades By Area

| Area | Grade | Rationale |
| --- | --- | --- |
| Architecture | B | Good layering intent and architecture tests, but several layer leaks and transitional violations remain. |
| Backend/application | B | Service extraction is solid; path and artifact-root contracts are not yet consistently enforced. |
| Parser/graph core | B- | Good adapter idea and schema ownership; import/call resolution remains too heuristic. |
| Webview/frontend | B- | Host abstraction and HTML safety are strong; components are large, stateful, and DOM-heavy. |
| Tests/static guards | A- | Architecture tests are unusually strong; some gaps remain around route method contracts, artifact roots, and containment. |
| Code cleanliness | B- | Many migration comments help, but duplication, debug logging, `any`, and legacy scripts remain. |
| Security/hardening | B | Good body caps/auth/static path checks/HTML safety. Symlink containment and raw workspace path joins remain open. |

## System Shape Observed

- `src/core`: path brands, graph ID contract, logger/error/config types.
- `src/workspace`: safe filesystem helper, currently textual containment only.
- `src/application`: scan, viewer data, watch toggling, document file/folder workflows.
- `src/parser`: adapters/registry and language extractors.
- `src/graph`: edge-list persistence, schema validation, graph conversion, watch state.
- `src/info`: structural info extraction/filtering/CLI support.
- `src/docs`: `.arch` path mapping.
- `src/mcp`: MCP tools and server handlers.
- `src/claude/server`: HTTP server, routes, file watching, arch watching, websocket refresh.
- `src/extension`: VS Code extension panel and hot reload.
- `src/webview`: static generator, worktree generation, webview UI.
- `tests/arch`: dependency, path, browser purity, HTML safety, graph ID, design doc key contracts.
- `src/test` and root `test`: legacy/manual verification scripts that are excluded from some arch scans.

## Finding 1: Workspace Path Containment Is Partial

Severity: High

Examples:

- `src/application/scan.ts` joins caller-supplied paths directly:
  - `path.join(workspaceRoot, filePath)`
  - `path.join(workspaceRoot, folderPath)`
  - recursive folder handling also raw-joins.
- `src/graph/worktree-state.ts` joins watched relative paths and artifact paths directly.
- `src/graph/edgelist.ts` accepts an artifact root and writes directly.
- `src/claude/server/arch-watcher.ts` has its own `.arch` containment helper instead of using shared workspace I/O.
- `tests/arch/workspace-paths.test.ts` still has a write allowlist for direct fs writes.

Risk:

- Branded path types are compile-time casts only. They do not make unsafe strings safe.
- Any route/tool/extension path bug can escape workspace boundaries unless every I/O call resolves through a runtime guard.
- The system currently has multiple containment implementations.

Implementation scaffold:

Create a workspace I/O abstraction:

```ts
// src/workspace/io.ts
export interface WorkspaceIO {
  resolve(candidate: RelPath | string): Promise<AbsPath>;
  resolveExistingFile(candidate: RelPath | string): Promise<AbsPath>;
  resolveExistingDirectory(candidate: RelPath | string): Promise<AbsPath>;
  exists(candidate: RelPath | string): Promise<boolean>;
  stat(candidate: RelPath | string): Promise<WorkspaceStat | null>;
  readText(candidate: RelPath | string): Promise<string | null>;
  writeText(candidate: RelPath | string, contents: string): Promise<void>;
  mkdir(candidate: RelPath | string): Promise<void>;
}

export function createWorkspaceIO(root: WorkspaceRoot): WorkspaceIO;
```

Implementation requirements:

- Normalize to workspace-relative paths at boundaries.
- Reject absolute paths outside root.
- Follow `fs.realpath` for existing paths and parent directories.
- For writes to new files, realpath the nearest existing parent directory.
- Return typed errors: `PathEscapeError`, `WorkspaceNotFoundError`, `WorkspaceTypeError`.
- Make sync variants only if a chokidar callback truly requires sync behavior.

Migration steps:

1. Extend `src/workspace/safe-fs.ts` or add `src/workspace/io.ts`.
2. Replace raw `path.join(workspaceRoot, rel)` in `src/application/scan.ts`.
3. Replace `.arch` read/write containment in `src/claude/server/arch-watcher.ts`.
4. Replace `WatchService` artifact/workspace joins.
5. Gradually remove files from `WRITE_ALLOWLIST`.
6. Add tests for absolute escape, `../`, symlinked parent escape, missing parent write, and Windows drive-letter paths.

## Finding 2: Safe-FS Allows Symlink Escape

Severity: High

Evidence:

- `tests/arch/workspace-paths.test.ts` explicitly documents that `resolveInsideWorkspace` is textual only and that realpath containment is future work.

Risk:

- A symlink inside the workspace can point outside and still pass textual containment.
- This is especially important because the tool writes `.arch` docs and `.artifacts` state.

Implementation scaffold:

```ts
async function resolveInsideWorkspaceReal(
  root: WorkspaceRoot,
  candidate: string,
  opts: { mustExist?: boolean; forWrite?: boolean } = {},
): Promise<AbsPath> {
  const textual = resolveInsideWorkspace(root, candidate);
  const realRoot = await fs.realpath(root);
  const targetForRealpath = opts.forWrite
    ? await nearestExistingParent(textual)
    : textual;
  const realTarget = await fs.realpath(targetForRealpath);
  assertRealChild(realRoot, realTarget);
  return textual;
}
```

Add tests:

- Read through symlink to outside should fail.
- Write through symlinked directory should fail.
- New file inside normal existing parent should pass.
- New file whose parent path crosses symlink should fail.

## Finding 3: Artifact Root Is Not A Universal Contract

Severity: High

Examples:

- `src/application/document-folder.ts` hard-codes `.artifacts`.
- `src/application/document-file.ts` does not need artifact root, but folder documentation does.
- Server and extension support configurable artifact roots elsewhere.
- Scripts import extension config as a transitional workaround.

Risk:

- Users with a non-default artifact root get inconsistent behavior.
- MCP, CLI, server, and extension can observe different graph state.

Implementation scaffold:

Introduce an artifact context:

```ts
// src/application/context.ts
export interface AppContext {
  workspaceRoot: WorkspaceRoot;
  artifactRoot: AbsPath;
  logger: Logger;
}

export function createAppContext(opts: {
  workspaceRoot: string;
  artifactRoot?: string;
  logger?: Logger;
}): AppContext;
```

Change request types:

```ts
export interface DocumentFolderRequest {
  workspaceRoot: WorkspaceRoot;
  artifactRoot: AbsPath;
  folderPath: RelPath;
  logger?: Logger;
}
```

Migration steps:

1. Thread `artifactRoot` into `buildDocumentFolderPrompt`.
2. Update MCP `folder-info` tool.
3. Update CLI folder info path.
4. Add integration tests where artifact root is not `.artifacts`.
5. Remove script imports from `src/extension/config.ts`.

## Finding 4: Mutating HTTP Route Does Not Check Method

Severity: High

File:

- `src/claude/server/routes/regenerate.ts`

Problem:

- `handleRegenerateRoute` accepts any HTTP method and regenerates after auth.
- With empty local-dev token, a GET can mutate state.

Implementation scaffold:

```ts
export async function handleRegenerateRoute(req, res, ctx) {
  if (req.method !== 'POST') {
    ctx.httpHandler.sendJson(res, 405, {
      success: false,
      message: `Method ${req.method} not allowed`,
    });
    return;
  }
  if (!requireApiToken(req, res, ctx.config, ctx.httpHandler)) return;
  await ctx.regenerateWebview();
  ctx.httpHandler.sendJson(res, 200, { success: true, message: 'Graph regenerated' });
}
```

Tests:

- `GET /api/regenerate` returns 405.
- `PUT /api/regenerate` returns 405.
- `POST /api/regenerate` still works with/without token according to config.

## Finding 5: Application Layer Imports Webview Layer

Severity: High

File:

- `src/application/viewer-data.ts`

Examples:

- Imports `generateWorkTree` from `src/webview/worktree`.
- Imports `computeAllFolderStatuses` from `src/webview/graph-status`.

Risk:

- Application layer depends on presentation-owned modules.
- Future frontend changes can break server/extension application behavior.
- Browser/server contracts are harder to reason about.

Implementation scaffold:

Move domain projections:

```text
src/application/viewer-model/
  collect-viewer-data.ts
  worktree-model.ts
  folder-status.ts
  design-doc-loader.ts
```

Then:

- `src/webview/worktree.ts` becomes either deleted or a thin re-export.
- `src/webview/graph-status.ts` moves to application or graph.
- Webview UI consumes data only through `DataProvider`; server/extension consume application services.

Tests:

- Update browser-purity/dependency tests to forbid `src/application -> src/webview`.
- Add a worktree model unit test independent of webview generation.

## Finding 6: Recursive Scan Repeatedly Loads And Saves Stores

Severity: Medium-high

File:

- `src/application/scan.ts`

Problem:

- `scanFolderRecursive` calls `scanFolder` for current folder and each subfolder.
- Each `scanFolder` constructs stores, loads, writes, and saves.

Risk:

- Poor performance on large workspaces.
- More filesystem writes than needed.
- Higher risk of race conditions with watchers or concurrent scan triggers.

Implementation scaffold:

```ts
export async function scanFolderRecursive(opts): Promise<ScanResult> {
  const stores = await loadScanStores(opts.artifactDir);
  const files = await collectSupportedFiles(opts.workspaceRoot, opts.folderPath, { recursive: true });
  const result = await scanFilesIntoStores(files, stores, opts);
  await stores.save();
  return result;
}
```

Suggested internal units:

- `collectSupportedFiles`
- `scanOneFileIntoStores`
- `loadScanStores`
- `saveScanStores`

Tests:

- Use mock stores or temp files to assert one load/save per recursive scan.
- Ensure ignored folders are skipped.
- Ensure file errors are accumulated and scan continues.

## Finding 7: Scan Error Discipline Is Inconsistent

Severity: Medium

File:

- `src/application/scan.ts`

Problem:

- Header comment says per-file failures are surfaced through `ScanResult.errors` and scan does not throw on individual errors.
- `scanFile` catches parser errors and throws `Failed to process ...`.
- `scanFolder` catches per-file parser errors and records them.

Risk:

- Callers must handle different error behavior for file vs folder scan.
- UI/API error rendering becomes inconsistent.

Implementation scaffold:

Define explicit modes:

```ts
export type ScanFailureMode = 'throw' | 'collect';
```

Or normalize:

- Input missing: throw.
- Unsupported/parse failure: always `ScanResult.errors`.

Then document this in `ScanResult`.

Tests:

- Unsupported single file returns `filesSkipped: 1`.
- Parse failure single file returns error entry, not throw.
- Missing file still throws.

## Finding 8: Parser Registry Singleton Has Side Effects And Console Logging

Severity: Medium-high

File:

- `src/parser/registry.ts`

Problems:

- Singleton hides availability state globally.
- Constructor dynamically requires optional parsers and logs to `console.error`.
- Tests and callers cannot inject adapter availability cleanly.

Risk:

- Harder deterministic testing.
- Noisy CLI/server logs.
- Runtime parser availability is mixed with registry construction.

Implementation scaffold:

```ts
export interface ParserRegistryOptions {
  adapters?: LanguageAdapter[];
  logger?: Logger;
  optionalLoaders?: OptionalParserLoader[];
}

export function createDefaultParserRegistry(opts?: { logger?: Logger }): ParserRegistry;
```

Make singleton a compatibility wrapper:

```ts
static getInstance(): ParserRegistry {
  return defaultRegistry ??= createDefaultParserRegistry();
}
```

Tests:

- Empty registry.
- Registry with fake adapter.
- Optional loader failure logs once at debug/warn, not error.

## Finding 9: Supported Extension Truth Is Split Between Config And Runtime Registry

Severity: Medium

Files:

- `src/parser/config.ts`
- `src/parser/registry.ts`
- `src/graph/worktree-state.ts`

Problems:

- `ALL_SUPPORTED_EXTENSIONS` includes optional tree-sitter adapter extensions even when packages are not installed.
- `ParserRegistry.isSupported` reflects runtime availability.
- `WatchService` has its own `PARSABLE_EXTS`, including extensions not in parser config such as `.java`, `.go`.

Risk:

- UI can mark files parsable that runtime cannot parse.
- Watch toggles can include unsupported files.
- Language support docs drift.

Implementation scaffold:

```ts
export interface LanguageSupport {
  id: string;
  extensions: readonly string[];
  runtimeAvailable: boolean;
  supportsImports: boolean;
  supportsCalls: boolean;
}

export interface LanguageSupportProvider {
  getByExtension(ext: string): LanguageSupport | null;
  getSupportedExtensions(opts?: { runtimeOnly?: boolean }): string[];
}
```

Use it in:

- Worktree generation.
- Watch service parsable filtering.
- Parser registry.
- Docs/roadmap generation.

## Finding 10: Generic Import Resolution Is Too Heuristic

Severity: High

File:

- `src/graph/artifact-converter.ts`

Problems:

- Relative import resolution returns the first extension candidate without checking existence.
- Dotted multi-part imports are assumed workspace paths.
- External module detection relies on no slash and no entity separator.
- Language-specific semantics live in generic conversion.

Risk:

- False internal edges.
- Missing external dependency edges.
- Bad graph for Python packages, TypeScript path aliases, `index` files, package exports, C++ includes, Rust modules.

Implementation scaffold:

Move resolution into parser/language layer:

```ts
export interface ResolvedImport {
  source: string;
  target: { kind: 'workspace'; fileId: FileId } | { kind: 'external'; module: ExternalModuleId };
  specifiers: ImportSpec[];
}

export interface ArtifactExtractor {
  extract(filePath: AbsPath): Promise<FileArtifact>;
  resolveImports?(artifact: FileArtifact, ctx: ResolveContext): Promise<ResolvedImport[]>;
}
```

Alternative lighter step:

```ts
export interface ImportResolver {
  resolve(sourceFileId: string, imp: ImportSpec): string | null;
}
```

Then inject resolver into `artifactToEdgeList`.

Tests:

- Python relative import from package `from . import x`.
- Python external dotted package `google.cloud.storage`.
- TypeScript extensionless relative import resolves `.ts`, `.tsx`, `index.ts`.
- TypeScript package import remains external.
- C++ include local vs system include.

## Finding 11: `artifactToEdgeList` Has Unused/Weak External Module State

Severity: Medium

File:

- `src/graph/artifact-converter.ts`

Problem:

- `externalModules` is collected and passed into `resolveCallToEdge`, but the function does not meaningfully use it.

Risk:

- Dead parameter implies incomplete design.
- Call resolution may create local edges for unresolved external calls.

Implementation scaffold:

- Delete the parameter if truly unused.
- Or use it to avoid local fallback for calls known to target external namespaces.
- Add tests for `os.path.join`, `fs.readFile`, package method calls, and local method calls.

## Finding 12: Edge-List Store Uses Arrays For Indexed Operations

Severity: Medium-high

File:

- `src/graph/edgelist.ts`

Problems:

- `addNode` scans by ID.
- `addEdge` scans by source/target.
- Remove by file/folder filters whole arrays.
- `getNodes` and `getEdges` expose mutable arrays.

Risk:

- Performance degrades on large graphs.
- External callers can mutate store data without dirty tracking.
- Duplicate semantics omit `kind` from edge uniqueness, relying on split stores.

Implementation scaffold:

Keep persisted schema arrays, change internals:

```ts
class BaseEdgeListStore {
  private nodesById = new Map<string, NodeEntry>();
  private edgesByKey = new Map<string, EdgeEntry>();

  private edgeKey(edge: EdgeEntry): string {
    return `${edge.kind}\0${edge.source}\0${edge.target}`;
  }

  getData(): EdgeListData {
    return {
      schemaVersion: EDGELIST_SCHEMA_VERSION,
      timestamp: this.timestamp,
      nodes: [...this.nodesById.values()],
      edges: [...this.edgesByKey.values()],
    };
  }
}
```

Migration steps:

1. Add indexes after load.
2. Return readonly copies from getters.
3. Keep JSON output stable.
4. Add tests for dirty tracking and mutation isolation.

## Finding 13: Edge-List Store Logs Directly

Severity: Low-medium

File:

- `src/graph/edgelist.ts`

Problem:

- Uses `console.error` and `console.warn` for routine save/no-op messages.

Risk:

- Noisy CLI/server output.
- Hard to control in extension context.

Implementation scaffold:

```ts
interface EdgeListStoreOptions {
  logger?: Logger;
}

new ImportEdgeListStore(artifactRoot, { logger });
```

Default to `NoopLogger` except CLI scripts.

## Finding 14: `save()` No-Op Logging Is Misclassified

Severity: Low

File:

- `src/graph/edgelist.ts`

Problem:

- `save()` logs `No changes to save` via `console.error`.

Risk:

- Looks like a failure in logs.

Implementation:

- Remove the log or make it debug-level.

## Finding 15: Graph Webview Transform Uses `any`

Severity: Medium

File:

- `src/graph/webview-data.ts`

Problem:

- `transformGraphsToVisData(importGraph: any, callGraph: any)`.
- Raw nodes mapped with `any`.

Risk:

- Graph structure changes will not be caught by TypeScript.
- Runtime-only failures in UI.

Implementation scaffold:

- Export concrete graph types from `src/graph/index.ts`.
- Type `buildGraphsFromSplitEdgeLists` return value.
- Make transform generic over `Graph<FileNode | EntityNode>`.

## Finding 16: External Module Node Kind Is Not In Persisted Schema

Severity: Medium

Files:

- `src/graph/webview-data.ts`
- `src/graph/edgelist-schema.ts`
- `src/graph/artifact-converter.ts`

Problem:

- Comments mention runtime `kind: 'external'`, but `NodeKindSchema` does not include `external`.
- `artifact-converter` currently stores external modules as `kind: 'file'`.

Risk:

- Type/runtime drift.
- Styling and filtering ambiguity.

Implementation choices:

1. Add `external` to `NodeKindSchema` and migrate old external file nodes.
2. Keep persisted `file`, but add a derived `isExternal` property in graph transform.

Recommended:

- Add `external` as a node kind if external modules are first-class graph nodes.

## Finding 17: Document-File And Document-Folder Duplicate Standard Library Filtering

Severity: Medium

Files:

- `src/application/document-file.ts`
- `src/application/document-folder.ts`

Problem:

- Both define `STDLIB_FUNCTIONS`.

Risk:

- Filter behavior drifts.
- Language-specific builtins cannot be handled cleanly.

Implementation scaffold:

```ts
// src/info/stdlib-filter.ts
export interface CallFilterOptions {
  language?: string;
}

export function isIgnorableCallTarget(name: string, opts?: CallFilterOptions): boolean;
```

Then use from both document services and graph/info filtering.

## Finding 18: Document-Folder File Count Can Be Wrong For Disconnected File Nodes

Severity: Medium

File:

- `src/application/document-folder.ts`

Problem:

- `renderStructuralMarkdown` builds `filesMap` from non-file nodes only.
- It then sorts `Array.from(filesMap.keys())`.
- File nodes with no entity nodes can contribute to `stats.files` but not render in the `FILES` section.

Implementation scaffold:

```ts
const fileIds = new Set(fileNodes.map(n => n.fileId));
for (const node of folderNodes) {
  if (node.kind !== 'file') fileIds.add(node.fileId);
}
for (const fileId of [...fileIds].sort()) {
  const entities = entitiesByFile.get(fileId) ?? [];
  ...
}
```

Tests:

- Folder with a file node and no entities appears in structural markdown.

## Finding 19: Document Prompt Construction Is Large String Template Logic

Severity: Medium

Files:

- `src/application/document-file.ts`
- `src/application/document-folder.ts`

Problem:

- Prompt templates and markdown renderers are embedded in application services.

Risk:

- Hard to test/diff.
- Business workflow and prompt formatting are coupled.

Implementation scaffold:

```text
src/application/document/prompts/
  file-prompt.ts
  folder-prompt.ts
  file-design-renderer.ts
  folder-readme-renderer.ts
```

Keep services as orchestration only.

## Finding 20: Application Viewer Data Silently Swallows Scan Errors

Severity: Medium

File:

- `src/application/viewer-data.ts`

Problem:

- On initial edge-list generation failure, logs and continues with empty edge lists.
- `scanAndPopulateSplitEdgeLists` catches per-file errors silently.

Risk:

- User sees empty graph without actionable reason.
- Debugging parser failures is hard.

Implementation scaffold:

Add diagnostics to `ViewerData`:

```ts
export interface ViewerData {
  graphData: WebviewGraphData;
  workTree: ITreeNode;
  designDocs: Record<string, string>;
  diagnostics: ViewerDiagnostic[];
}
```

At minimum, log per-file failures at warn level with path and message.

## Finding 21: Viewer Data Initial Scan Only Handles TypeScript

Severity: Medium-high

File:

- `src/application/viewer-data.ts`

Problem:

- Initial scan uses `TypeScriptService` and `TypeScriptExtractor` directly.
- Other languages are registry-supported elsewhere.

Risk:

- Multi-language support is inconsistent.
- Webview initial graph may omit Python/Rust/C++/R files until a different scan path runs.

Implementation scaffold:

- Replace `scanAndPopulateSplitEdgeLists` with the same registry-based scan engine used by `application/scan.ts`.
- Share `scanFilesIntoStores` from Finding 6.

## Finding 22: Legacy Script Boundary Violations Remain

Severity: Medium

Files:

- `src/scripts/scan_codebase.ts`
- `src/scripts/generate_webview.ts`
- `tests/arch/dependencies.test.ts`

Problem:

- Scripts import `src/extension/config.ts`.
- Known violations are documented in the dependency arch test.

Risk:

- Extension runtime remains a config dumping ground.
- CLI/script execution may pull in VS Code assumptions.

Implementation scaffold:

Create config runtime outside extension:

```text
src/config/
  defaults.ts
  env.ts
  loader.ts
  schema.ts
```

Then:

- `src/extension/config.ts` becomes VS Code adapter around shared config.
- `src/claude/config.ts` uses shared loader.
- scripts use shared loader.
- Remove known violations.

## Finding 23: Legacy Verification Scripts Are Excluded From Architecture Scans

Severity: Medium

Files:

- `src/test/*`
- root `test/*.ts`
- architecture tests skip `src/test`.

Problem:

- Legacy scripts remain in repo and are excluded from important architecture checks.

Risk:

- Dead code can rot and mislead contributors.
- Duplicate tests exist in `test/`, `tests/`, and `src/test/`.

Implementation scaffold:

Inventory each script:

- If it is a real test, migrate to `tests/unit` or `tests/integration`.
- If manual-only, move to `scripts/dev` and exclude intentionally.
- If obsolete, delete.

Then remove `src/test` exclusions from arch tests.

## Finding 24: Webview Components Can Leak Subscriptions On Remount

Severity: Medium-high

Files:

- `src/webview/ui/components/Worktree.ts`
- `src/webview/ui/components/GraphView.ts`
- `src/webview/ui/components/DesignTextView.ts`

Problems:

- `mount()` subscribes without first unsubscribing old subscriptions.
- `GraphView.mount()` adds `theme-changed` listener each mount.
- Refresh paths call component `mount()` again.

Risk:

- Duplicate renders and state handling after refresh.
- Memory leaks in long-lived panel/server pages.

Implementation scaffold:

Adopt component lifecycle rule:

```ts
async mount() {
  this.unmount();
  ...
  this.unsubscribe = this.state.subscribe(...);
}
```

Or split:

- `init()` attaches one-time listeners.
- `refreshData()` reloads data and rerenders.
- `dispose()` detaches listeners.

Tests:

- Mount twice, state change triggers callback once.
- GraphView mount twice, window listener called once.

## Finding 25: `DesignTextView` Is Too Large And Mixes Too Many Concerns

Severity: Medium-high

File:

- `src/webview/ui/components/DesignTextView.ts`

Responsibilities currently mixed:

- Shadow DOM setup.
- CSS ownership.
- State subscription.
- Design doc cache lookup.
- API fallback fetch.
- Save path construction.
- Renderer lifecycle.
- Debug logging.
- Empty-state rendering.

Implementation scaffold:

Split into:

```text
src/webview/ui/design/
  designDocKeys.ts
  DesignDocLookup.ts
  DesignDocEditorController.ts
  DesignEmptyState.ts
```

Possible APIs:

```ts
export function getDesignDocCandidates(selectedPath: string, selectedType: NodeType): string[];
export function getSavePath(selectedPath: string, selectedType: NodeType): string;
export class DesignDocController { ... }
```

Tests:

- Candidate key generation for file with extension.
- Directory README lookup.
- Save path for file and directory.
- Backward compatibility keys.

## Finding 26: Design Doc Key Mapping Is Duplicated Between Backend And Webview

Severity: Medium

Files:

- `src/docs/arch-store.ts`
- `src/webview/ui/components/DesignTextView.ts`
- `src/claude/server/arch-watcher.ts`

Problem:

- Backend has canonical key functions.
- Frontend has its own candidate/key/save path logic.
- Server arch watcher accepts relative doc paths and appends `.md`.

Risk:

- Save path and fetch path drift.
- File docs with extension vs without extension have backward-compat complexity.

Implementation scaffold:

Create browser-safe shared doc key module:

```text
src/common/design-doc-keys.ts
```

No Node imports. Use pure path string normalization.

Backend `docs/arch-store.ts` can wrap it with absolute path resolution.

## Finding 27: Webview Uses `any` To Reach Private Component Internals

Severity: Low-medium

Files:

- `src/webview/ui/main.ts`
- `src/webview/ui/components/DesignTextView.ts`
- `src/webview/ui/components/GraphView.ts`

Examples:

- `(designTextView as any).triggerSave()`
- `(window as any).WATCHED_FILES`
- `(this.dataProvider as any).designDocCache?.fetch(...)`
- `this.currentGraphType as any` on render.

Implementation scaffold:

- Add `triggerSave()` to a declared interface.
- Extend `Window` type declarations for injected globals.
- Add optional `fetchDesignDoc(path)` method to `DataProvider`.
- Use `GraphType` union type consistently.

## Finding 28: Debug Logging Leaks Content Previews In Frontend

Severity: Medium

File:

- `src/webview/ui/components/DesignTextView.ts`

Problem:

- Logs markdown value preview and content length during save.

Risk:

- Sensitive design docs/source notes appear in browser/VS Code developer logs.
- Noisy output.

Implementation:

- Remove content preview logs.
- Keep only debug-level metadata behind a debug flag if needed.

## Finding 29: Worktree Watch State Uses Repeated DOM Scans

Severity: Medium

File:

- `src/webview/ui/components/Worktree.ts`

Problem:

- `collectAllFilePaths` scans all `.status-btn` elements for each folder state check.
- `updateWatchedButtons` scans all buttons and calls descendant scan repeatedly.

Risk:

- O(n^2)-like behavior in large trees.
- DOM is used as source of truth instead of loaded worktree data.

Implementation scaffold:

Build an index after worktree load:

```ts
interface WorktreeIndex {
  filesByFolder: Map<string, string[]>;
  nodeByPath: Map<string, WorkTreeNode>;
}
```

Then:

- Folder all-watched check uses `filesByFolder`.
- Descendant any-watched check uses `filesByFolder`.
- DOM only reflects state, not computes it.

## Finding 30: Alert-Based Error UX In Webview

Severity: Low-medium

File:

- `src/webview/ui/components/Worktree.ts`

Problem:

- Toggle failures call `alert(...)`.

Risk:

- Blocks UI.
- Poor UX in VS Code webview.

Implementation scaffold:

Add app notification state:

```ts
interface AppNotification {
  id: string;
  kind: 'error' | 'info';
  message: string;
}
```

Render nonblocking inline toast/status message.

## Finding 31: Router No Longer Routes

Severity: Low-medium

File:

- `src/webview/ui/router.ts`

Problem:

- The route visibility logic is disabled for the 3-column layout.
- Router now mostly validates `currentView` and can write an error into `document.body`.

Risk:

- Dead abstraction.
- Future maintainers may expect routing behavior that does not exist.

Implementation options:

1. Rename to `ViewStateGuard` if validation is all that remains.
2. Delete router and validate view state in toggles/state setter.
3. Reintroduce route lifecycle if mobile/single-pane layout needs it.

## Finding 32: Graph Renderer Reconstructs Data From DOM

Severity: Medium

File:

- `src/webview/ui/graph/GraphRenderer.ts`

Problem:

- `getAllNodesFromLayout` reconstructs nodes by querying `.node-group` and text content.

Risk:

- DOM and model drift.
- Incremental rendering loses typed node metadata.

Implementation scaffold:

Maintain renderer model state:

```ts
private currentNodes = new Map<string, VisNode>();
```

On render:

- Populate `currentNodes`.
- Incremental add merges into map.
- Render from map, not DOM.

## Finding 33: GraphView Resize Re-Renders Whole Graph

Severity: Medium

File:

- `src/webview/ui/components/GraphView.ts`

Problem:

- Resize handler calls `render` after resize.
- Layout recomputes and full SVG rerenders.

Risk:

- Poor resize performance for large graphs.

Implementation options:

- Fast path: update viewBox and camera bounds without recomputing layout.
- Debounced full recompute only when container size changes significantly.
- Keep layout independent of viewport where possible.

## Finding 34: Frontend Inline Styles Reduce Maintainability

Severity: Low-medium

Files:

- `src/webview/ui/components/Worktree.ts`
- `src/webview/ui/components/DesignTextView.ts`

Problems:

- Status button styles inline in generated HTML.
- Large CSS string embedded in `DesignTextView`.

Implementation:

- Move stable styles to CSS files or component style modules.
- Keep only dynamic values in classes/attributes.

## Finding 35: HTML Safety Test Is Good But Relies On Comments For Some Cases

Severity: Low-medium

Files:

- `tests/arch/html-safety.test.ts`
- webview UI files

Problem:

- Some `innerHTML` assignments are accepted via `// safe:` comments.

Risk:

- Human annotation can be wrong.

Implementation:

- Prefer DOM construction helpers for new UI.
- Add `setSafeHtml(el, trustedHtml)` and `setEscapedTemplate`.
- Limit comment-based escapes to static icon strings.

## Finding 36: Static Data Globals Are Weakly Typed

Severity: Low-medium

Files:

- `src/webview/ui/services/staticDataProvider.ts`
- `src/webview/ui/main.ts`
- `src/webview/ui/types.ts`

Problem:

- `window.GRAPH_DATA`, `window.WORK_TREE`, `window.WATCHED_FILES` are used as globals with loose typing.

Implementation:

Add a `globals.d.ts` or module declaration:

```ts
declare global {
  interface Window {
    GRAPH_DATA?: GraphData;
    WORK_TREE?: WorkTreeNode;
    DESIGN_DOCS?: Record<string, DesignDoc>;
    WATCHED_FILES?: string[];
  }
}
```

## Finding 37: MCP/Server Tool Boundaries Need Stronger Request Validation

Severity: Medium

Files:

- `src/claude/server/routes/*.ts`
- `src/mcp/tools/*.ts`

Problem:

- Some route bodies are parsed manually.
- Path strings become branded via casts.

Risk:

- Runtime invalid inputs can cross into application services.

Implementation:

- Use `zod` request schemas at HTTP/MCP boundaries.
- Convert to branded path types only after validation and workspace resolution.

## Finding 38: ArchWatcher Has Its Own Markdown Rendering And Direct FS Writes

Severity: Medium

File:

- `src/claude/server/arch-watcher.ts`

Problems:

- Direct `fs.readFileSync`, `fs.writeFileSync`, `fs.mkdirSync`.
- Own path boundary assertion.
- Dynamic `marked` loading via `new Function`.

Risk:

- Duplicates safe-fs and markdown conversion logic.
- `new Function` may be blocked by strict CSP-like environments.

Implementation scaffold:

- Inject `WorkspaceIO` scoped to `.arch`.
- Inject `MarkdownRenderer`.
- Use regular dynamic import if build supports it, or centralize the `marked` loader.

## Finding 39: Markdown Rendering Is Split Across Layers

Severity: Medium

Files:

- `src/webview/design-docs.ts`
- `src/webview/utils/md-converter.ts`
- `src/claude/server/arch-watcher.ts`
- `src/webview/ui/components/DesignRender.ts`

Problem:

- Markdown conversion/sanitization responsibilities are not clearly centralized.

Implementation:

Define:

- Server-side markdown rendering module.
- Browser-side sanitization module.
- Explicit contract: backend may send markdown and optional HTML; frontend sanitizes before insertion.

## Finding 40: Logger Discipline Is Inconsistent

Severity: Medium

Examples:

- `src/application/scan.ts` documents no console and mostly follows it.
- `src/application/viewer-data.ts` documents no console and mostly follows it.
- `src/parser/registry.ts`, `src/graph/edgelist.ts`, `src/graph/worktree-state.ts`, `src/claude/server/*`, `src/extension/*`, and webview components log directly.

Risk:

- Hard to control verbosity by host.
- Extension, CLI, and server logs cannot be consistently filtered.

Implementation:

- Use `Logger` everywhere except CLI entrypoints.
- Add `DebugLogger` and `TaggedLogger`.
- Add an architecture test for `console.*` allowlist in production modules.

## Finding 41: `any` Usage Remains Broad

Severity: Medium

Examples:

- HTTP JSON send helper uses `any`.
- Webview graph data transform uses `any`.
- Extension panel message handler uses `any`.
- Arch watcher `marked` is `any`.
- Tests use `as any` for fixtures.

Implementation:

- Define message/event/data contracts.
- Use `unknown` at external boundaries and narrow with schemas.
- Keep `any` only in tests or third-party interop adapters.

## Finding 42: Extension Panel Is Large And Likely Duplicates Server/Webview Work

Severity: Medium

File:

- `src/extension/panel.ts`

Problems observed from static scan:

- Large file.
- Direct message handling, scan calls, watch toggling, design doc handling, graph node loading.
- Console logging.

Implementation scaffold:

Split:

```text
src/extension/panel/
  LLMemPanel.ts
  panelMessages.ts
  panelDataController.ts
  panelWatchController.ts
  panelGraphController.ts
```

Use typed webview message schemas shared with `VSCodeDataProvider`.

## Finding 43: Extension Hot Reload Is Large And Console-Oriented

Severity: Medium

File:

- `src/extension/hot-reload.ts`

Problems:

- Large lifecycle service.
- Direct console logs.
- Watches several domains and triggers scans/refreshes.

Implementation:

- Split watch adapters from update orchestration.
- Share watch/regeneration logic with server where possible.
- Inject logger.

## Finding 44: Server Lifecycle Is Reasonably Split But Regeneration Concurrency Is Local

Severity: Medium

File:

- `src/claude/server/index.ts`

Problem:

- `isRegenerating` is a boolean in server, guarding source/edge changes.
- Regeneration route can still call `regenerateWebview()` directly through context.

Risk:

- Concurrent route-triggered and watcher-triggered regenerations can interleave.

Implementation:

Add a regeneration queue/service:

```ts
class RegenerationCoordinator {
  enqueue(reason: RegenerationReason): Promise<void>;
}
```

All route and watcher paths use it.

## Finding 45: Request Body Reader Could Reject Twice

Severity: Low-medium

File:

- `src/claude/server/http-handler.ts`

Observation:

- `readRequestBody` rejects on overflow, then ignores later chunks/end. This is mostly okay.

Potential improvement:

- Ensure all listeners are cleaned up on resolve/reject.
- Consider `once` semantics and a settled guard for all paths.

## Finding 46: Static File URL Decoding Semantics Are Not Fully Clear

Severity: Low-medium

File:

- `src/claude/server/http-handler.ts`

Observation:

- Path traversal checks cover raw paths and encoded examples via tests.
- The code does not explicitly decode URL path before normalize/join.

Risk:

- Depending on Node URL handling and filesystem names, encoded slashes may behave unexpectedly.

Implementation:

- Parse URL path with `new URL`.
- Reject encoded slash/backslash traversal forms explicitly or decode once then contain.
- Keep tests for encoded traversal.

## Finding 47: `GraphServer.startServer` Ignores Artifact Root/API Token Options

Severity: Low-medium

File:

- `src/claude/server/index.ts`

Problem:

- Convenience `startServer(workspaceRoot, port)` only accepts root and port.

Implementation:

- Add overload or accept `ServerConfig`.

## Finding 48: WatchService Has Direct Artifact Writes And Own Parsable Extensions

Severity: Medium

File:

- `src/graph/worktree-state.ts`

Problems:

- Direct fs writes.
- `PARSABLE_EXTS` duplicates parser support.
- Path containment not centralized.

Implementation:

- Inject `WorkspaceIO` / artifact state store.
- Use language support provider for parsable files.
- Return diagnostics for skipped inaccessible folders.

## Finding 49: `removeFolder` Mutates Set During Iteration

Severity: Low-medium

File:

- `src/graph/worktree-state.ts`

Problem:

- Deletes from `this.watchedFiles` while iterating it.

Risk:

- JS Set iteration tolerates this, but collecting then deleting is clearer and safer.

Implementation:

```ts
const toRemove = [...this.watchedFiles].filter(...);
for (const file of toRemove) this.removeFile(file);
```

## Finding 50: Missing Atomic Writes For Artifact/State Files

Severity: Medium

Files:

- `src/graph/edgelist.ts`
- `src/graph/worktree-state.ts`
- `.arch` writes

Problem:

- Writes go directly to final file.

Risk:

- Process interruption can leave corrupt JSON/Markdown.

Implementation scaffold:

```ts
async function atomicWriteText(path, contents) {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, contents, 'utf8');
  await fs.rename(tmp, path);
}
```

Use for JSON state. Consider same for docs.

## Finding 51: Edge-List Load Throws Loudly But Callers May Not Handle It

Severity: Medium

Files:

- `src/graph/edgelist.ts`
- callers in application/server/scripts

Problem:

- Schema failures now throw, which is correct, but callers need clear user-facing handling.

Implementation:

- Catch `EdgeListLoadError` at UI/server/MCP boundaries.
- Return diagnostic: corrupt artifact path, reason, suggested regenerate/backup action.

## Finding 52: Graph ID External Module Detection Is Too Simple

Severity: Medium

File:

- `src/core/ids.ts`

Problem:

- External module if no `::` and no `/`.

Risk:

- Scoped packages like `@scope/pkg` contain `/`.
- Python packages may use dotted names.
- File IDs outside `src/` can be slashless at root.

Implementation:

Make ID kind explicit at construction/persistence where possible. If persisted edge-list cannot change yet, add robust classifier using node metadata rather than string shape.

## Finding 53: Entity ID Separator Cannot Represent Entity Names Containing `::`

Severity: Low-medium

File:

- `src/core/ids.ts`

Problem:

- Contract explicitly does not support entity names containing `::`.

Risk:

- Unusual but possible in generated or non-TS languages.

Implementation options:

- Leave as documented if acceptable.
- Or move persisted IDs to escaped components / structured references in schema v2.

## Finding 54: Path Branding Functions Are Unsafe Casts

Severity: Medium

File:

- `src/core/paths.ts`

Problem:

- `asWorkspaceRoot`, `asAbsPath`, `asRelPath` do no validation.

Risk:

- Branding can create false confidence.

Implementation:

- Keep `as*` for low-level bridge only.
- Add validating constructors:

```ts
export function parseWorkspaceRoot(input: string): WorkspaceRoot;
export function parseRelPath(input: string): RelPath;
```

- Ban `asRelPath` outside boundary/adapter files via arch test or lint allowlist.

## Finding 55: Webview Data Provider Request Map For Folder Nodes Is Keyed Only By Folder Path

Severity: Low-medium

File:

- `src/webview/ui/services/vscodeDataProvider.ts`

Problem:

- `pendingFolderNodeRequests` is keyed by folder path, unlike watch toggles which use request IDs.

Risk:

- Concurrent duplicate folder loads can overwrite each other.

Implementation:

- Add request IDs to folder node request/response too.
- Keep legacy fallback by folder path if needed.

## Finding 56: DataProvider `dataReady` Has No Timeout Or Error State

Severity: Low-medium

File:

- `src/webview/ui/services/vscodeDataProvider.ts`

Problem:

- If extension never sends `data:init`, component loads await forever.

Implementation:

- Add timeout diagnostic or error state.
- Expose `loadInitialData(): Promise<Result<...>>`.

## Finding 57: State Store Is Minimal And Unvalidated

Severity: Low-medium

File:

- `src/webview/ui/state.ts`

Problem:

- `set(partial)` accepts any partial state and notifies all listeners.

Risk:

- Invalid combinations: `selectedPath` with null type, invalid current view if cast.

Implementation:

- Add action methods or reducer:

```ts
selectPath(path, type, source)
setGraphType(type)
setDesignMode(mode)
```

- Keep low-level `set` private or validated.

## Finding 58: Frontend Rendering Uses Large String Templates

Severity: Medium

Files:

- `Worktree.ts`
- `DesignTextView.ts`
- `Router.ts`

Risk:

- Requires careful escaping discipline.
- Harder incremental updates.

Implementation:

- Introduce tiny DOM builder helpers for new code:

```ts
el('span', { class: 'label' }, text(node.name))
```

- Avoid expanding framework dependency unless app complexity grows further.

## Finding 59: Build Scripts And Runtime Scripts Duplicate Graph Generation Concepts

Severity: Medium

Files:

- `src/scripts/generate_edgelist.ts`
- `src/scripts/scan_codebase.ts`
- `src/scripts/generate-call-edges.ts`
- `src/application/scan.ts`
- `src/application/viewer-data.ts`

Problem:

- Multiple paths scan/generate edge lists.

Risk:

- Behavior drift and bug fixes landing in one path only.

Implementation:

- Make scripts thin wrappers over application services.
- Define one `GraphGenerationService`.

## Finding 60: Root Package Scripts Are Somewhat Overlapping

Severity: Low

File:

- `package.json`

Observation:

- `compile`, `compile:all`, `build`, `build:vscode`, `build:all`, `serve`, `serve:dev`, `graph`, `scan`, `view`, `view:graph`.

Implementation:

- Document script purpose or simplify naming:
  - `build:extension`
  - `build:webview`
  - `build:server`
  - `dev:server`
  - `graph:generate`

## Finding 61: ESLint Rules Are Lenient For Excellence Target

Severity: Low-medium

File:

- `.eslintrc.json`

Problem:

- `no-explicit-any` and `no-require-imports` are warnings.

Implementation:

- Keep warnings for now but add targeted no-console and no-any allowlist tests.
- Later promote to error outside adapters/tests.

## Finding 62: Dependency Direction Tests Are Good But Need Expanded Rules

Severity: Medium

Current rules cover:

- MCP must not depend on extension.
- Extension/script/config-defaults boundaries.
- Deprecated artifact dependencies.
- Claude must not depend on extension.

Add rules:

- `application -> webview` forbidden.
- `application -> extension/claude/mcp/scripts` forbidden.
- `graph -> webview/application/extension/claude/mcp` forbidden.
- `parser -> graph/application/webview` forbidden except shared types if needed.

## Finding 63: Browser Purity Test Is Direct-Import Only

Severity: Low-medium

File:

- `tests/arch/browser-purity.test.ts`

Problem:

- It does not chase transitive imports.

Risk:

- A browser-safe-looking webview module can import another local module that imports Node APIs.

Implementation:

- Build a module graph from webview UI entrypoints and check transitive closure.
- Keep direct scanner as fast first line.

## Finding 64: Server Auth Is Optional By Empty Token

Severity: Medium depending on deployment

Files:

- `src/claude/server/routes/auth.ts`
- server config

Observation:

- Empty token means mutating endpoints are open on localhost.

Risk:

- Acceptable for local dev, but dangerous if host binding changes or reverse proxy exposes it.

Implementation:

- Keep `127.0.0.1` binding.
- Warn loudly when `apiToken` is empty and server is started.
- If adding non-local bind support, require token.

## Finding 65: Server Static Handler Uses Sync FS Checks Then Async Read

Severity: Low

File:

- `src/claude/server/http-handler.ts`

Problem:

- `existsSync` / `statSync` in request path.

Implementation:

- Convert to `fs.promises.stat/readFile` if serving many concurrent requests matters.

## Finding 66: Use Of `new Function` For Dynamic Import

Severity: Low-medium

Files:

- `src/claude/server/arch-watcher.ts`
- possibly `src/extension/panel.ts` / markdown loaders

Problem:

- Used to load ESM `marked`.

Risk:

- Harder CSP/security posture.
- Harder bundler analysis.

Implementation:

- Centralize dynamic import adapter.
- Prefer normal `await import('marked')` if TS/build supports target.

## Finding 67: Tests Include Some Heavy Integration In `src/` Instead Of `tests/`

Severity: Low-medium

Examples:

- `src/mcp/tools.test.ts`
- `src/mcp/server.test.ts`
- `src/graph/*.test.ts`
- `src/parser/parser-integration.test.ts`

Observation:

- This can be fine, but project also has separate `tests/` and root `test/`.

Implementation:

- Decide convention:
  - Co-located tests in `src` for unit tests, or
  - all tests under `tests`.
- Remove third pattern.

## Finding 68: Test Names And Paths Use Both `webview` And `web-viewer`

Severity: Low

Examples:

- `tests/unit/webview`
- `tests/unit/web-viewer`

Implementation:

- Standardize directory naming to `webview`.

## Finding 69: Static Review Found Generated/Third-Party Library In Source Tree

Severity: Low-medium

File:

- `src/webview/ui/libs/Splitter.ts`
- possibly bundled/minified content under source was visible in grep output.

Observation:

- Vendored or generated code can confuse static scans.

Implementation:

- If third-party, move to `vendor` or document provenance.
- Exclude generated bundles from code smell scans.

## Finding 70: UI Design/UX Quality Is Functional But Tooling-Oriented

Severity: Low-medium

Observation:

- The app has the right panes and controls for a developer tool.
- Styling appears mostly practical.
- Some UX issues: alert errors, debug logs, status dot-only affordance, graph-only mode manipulation in `main.ts`.

Implementation:

- Add a small status/toast component.
- Add tooltips/accessible labels for watch dots.
- Move graph-only layout mode to CSS class on root instead of imperative style assignments.

## Proposed Implementation Tracks

### Track A: Safety And Contracts

Goal: all workspace/artifact reads/writes go through one runtime-safe abstraction.

Tasks:

1. Add `WorkspaceIO` with realpath containment.
2. Add validating path constructors.
3. Migrate `scan.ts`, `WatchService`, `ArchWatcherService`, `EdgeListStore`.
4. Add route/MCP zod request schemas.
5. Remove or shrink `WRITE_ALLOWLIST`.
6. Add route method tests.

Acceptance:

- No raw mutating fs calls outside known low-level modules.
- Symlink escape tests fail before fix and pass after.
- `GET /api/regenerate` returns 405.

### Track B: Application Boundary Cleanup

Goal: presentation and host layers depend on application/domain, not the reverse.

Tasks:

1. Move worktree and graph status projections out of `src/webview`.
2. Add dependency rule forbidding `application -> webview`.
3. Introduce `AppContext`.
4. Thread `artifactRoot` through document folder and all callers.
5. Move shared config loader out of extension.
6. Remove known dependency violations.

Acceptance:

- Dependency tests have no known violations for scripts/config.
- Application layer does not import webview.

### Track C: Graph Generation Unification

Goal: one graph generation pipeline used by CLI/server/extension/viewer.

Tasks:

1. Extract reusable scan engine from `application/scan.ts`.
2. Replace viewer initial TS-only scan with registry-based scan engine.
3. Add language support provider.
4. Move import resolution into language-specific resolvers.
5. Add graph diagnostics for parser failures.

Acceptance:

- Python/Rust/C++/R initial graph behavior matches explicit runtime support.
- Recursive scans load/save once.
- Import resolution tests cover core language cases.

### Track D: Edge Storage Robustness

Goal: reliable and scalable edge-list state.

Tasks:

1. Add indexed internals.
2. Return immutable copies.
3. Add atomic writes.
4. Improve load-error handling at app boundaries.
5. Resolve external node kind contract.

Acceptance:

- Existing JSON schema remains compatible.
- Store operations are near O(1) for add/update.
- Corrupt edge-list diagnostics are user-facing.

### Track E: Webview Component Quality

Goal: smaller components, no listener leaks, better model/view separation.

Tasks:

1. Split `DesignTextView`.
2. Add shared browser-safe design doc key module.
3. Add Worktree index.
4. Fix mount/unmount idempotency.
5. Replace alert with notification state.
6. Remove debug content logging.
7. Type window globals and data provider extension points.
8. Keep graph renderer model state instead of DOM reconstruction.

Acceptance:

- Mount twice does not duplicate listeners.
- Save/fetch doc path behavior is unit tested.
- Worktree watched state uses tree index, not DOM scans.

### Track F: Legacy Cleanup

Goal: reduce confusing duplicate paths and excluded code.

Tasks:

1. Inventory `src/test` and root `test`.
2. Migrate valuable tests to `tests/unit` or `tests/integration`.
3. Delete obsolete scripts.
4. Standardize test directory naming.
5. Normalize package script names and document them.

Acceptance:

- Architecture tests no longer need to skip `src/test`.
- One test organization convention.

## Suggested Sequencing

Phase 1: Quick correctness fixes

- Add method check to `/api/regenerate`.
- Remove frontend markdown content preview logging.
- Add DataProvider method instead of `(as any).designDocCache`.
- Add graph/doc key unit tests around current behavior.

Phase 2: Safety foundation

- Implement `WorkspaceIO` with realpath.
- Migrate `scan.ts`, `document-folder`, `arch-watcher`, and `WatchService`.
- Add zod schemas at HTTP/MCP boundaries.

Phase 3: Boundary cleanup

- Move viewer model modules out of webview.
- Add dependency rules.
- Move config loader out of extension.
- Remove known dependency violations.

Phase 4: Graph pipeline

- Extract scan engine.
- Use registry in viewer initial scan.
- Add language support provider.
- Introduce import resolver contract.

Phase 5: Frontend refactor

- Split `DesignTextView`.
- Add Worktree index.
- Fix component remount lifecycle.
- Improve notifications.

Phase 6: Storage and legacy cleanup

- Indexed edge-list internals.
- Atomic writes.
- Retire legacy tests/scripts.

## Initial Issue-To-Test Matrix

| Issue | Test Type |
| --- | --- |
| Regenerate method semantics | Integration HTTP |
| Artifact root consistency | Integration document-folder |
| Scan path containment | Unit/application |
| Symlink containment | Arch/workspace |
| Application imports webview | Arch/dependency |
| Recursive scan one save | Unit with fake store or temp artifact |
| Parser registry injection | Unit/parser |
| Language support runtime truth | Unit/parser/config |
| Import resolver cases | Unit/graph per language |
| Edge store immutable getters | Unit/graph |
| Atomic write | Unit/workspace or graph |
| Design doc key mapping | Unit/webview + unit/docs |
| Component remount leak | Unit/jsdom |
| Worktree index | Unit/webview |
| Route body schema | Integration HTTP |

## Definition Of Done For Excellence

- No known architecture violations remain unless tied to an active migration branch with owner/date.
- Workspace path containment is runtime-enforced and symlink-safe.
- Artifact root is not hard-coded in application services.
- Webview UI modules have no direct Node/extension dependencies, direct or transitive.
- Large components have clear single responsibilities.
- All external inputs are parsed as `unknown` and narrowed.
- Logging is host-controlled.
- Legacy tests/scripts are either migrated, documented, or removed.
- Graph generation has one pipeline and language-specific resolution contracts.
- Edge-list persistence is atomic, schema-validated, and indexed internally.

---

## Appendix A — Carry-Over From Static-Review-Excellence (Loops 15-17 Deferreds)

The 17-loop static-review-excellence stream (commits `4321497` through `e52bed5`) closed Phases 0-7 of `STATIC_REVIEW_IMPLEMENTATION_SPEC_2026-05-02.md`. The items below surfaced during those loops but were left for follow-up, and are NOT covered by Findings 1-70 above.

### A1. `__dirname` resolution bug in `src/claude/web-launcher.ts`

Severity: Medium

Surfaced: Loop 17 (when arch-watcher tests were brought into the integration sweep).

Problem:

- Under the new `node --require ts-node/register --test` harness, `__dirname` inside `web-launcher.ts` resolves to the source path, not the dist path. Three test suites that exercise the static-site launcher transitively skip on this:
  - `tests/integration/arch-watcher.test.ts` Server-API suite
  - `tests/integration/arch-watcher.test.ts` WebSocket suite
  - `tests/integration/arch-watcher.test.ts` E2E suite
- The 5 unit tests in the same file pass; the skipped ones never ran in CI before because the legacy `dist/**/*.test.js` glob excluded `src/claude/`.

Risk:

- Three suites that should pin static-site/launcher behavior do not run.
- Any regression in the launcher reaches users without test coverage.

Implementation:

- Resolve launcher asset paths via an injected `assetRoot: AbsPath` set by the entrypoint (`bin/llmem` and the extension), rather than computing `path.join(__dirname, '..')` at runtime.
- Or use `import.meta.url` with a fallback that ts-node and dist agree on.

Acceptance:

- All three skipped arch-watcher suites run green.
- Integration test count reaches the full surface.

### A2. `src/claude/` per-deliverable folder split

Severity: Medium

Surfaced: documented in `CURRENT_STATE_2026-05-02.md` §2; partially resolved by Loop 11 (HTTP routes split into `src/claude/server/routes/`).

Problem:

- `src/claude/` still mixes 4 distinct deliverables in one folder:
  1. MCP stdio server (`src/claude/index.ts`)
  2. Long-running HTTP + WebSocket + watchers (`src/claude/server/`)
  3. Static-site launcher (`src/claude/web-launcher.ts`)
  4. CLI entrypoint (`src/claude/cli.ts`)
- They share the folder, not types or boundaries.

Risk:

- Folder name implies cohesion that is not there.
- Boundary tests (`tests/arch/dependencies.test.ts`) treat the folder as one unit, hiding violations between sub-deliverables.
- Future contributors expect a uniform module style across the folder.

Implementation:

```text
src/claude/
  mcp/        # was index.ts (MCP stdio server)
  server/     # unchanged (HTTP + WS + watchers)
  launcher/   # was web-launcher.ts
  cli/        # was cli.ts
```

Each subfolder gets its own `index.ts` re-export. Update `package.json` `bin`, `tsconfig.claude.json`, and any imports.

Acceptance:

- Each `src/claude/<sub>/` is a self-contained deliverable with a narrow `index.ts` boundary.
- `tests/arch/dependencies.test.ts` rules forbid `mcp -> launcher`, `cli -> server` etc. unless explicit.

### A3. Shared core tsconfig for `parser`, `graph`, `info`

Severity: Medium

Surfaced: documented in `CURRENT_STATE_2026-05-02.md` §6; partially addressed by Loops 03-04 (introduction of `src/core/`, `src/workspace/`, `src/docs/`).

Problem:

- `tsconfig.vscode.json` excludes `src/claude/`. `tsconfig.claude.json` excludes `src/extension/`. Both **include** `src/parser/`, `src/graph/`, `src/info/` — so a change in `src/parser/ts-service.ts` is built into two distinct `dist/` trees.
- There is no `tsconfig.core.json` for the parts both hosts share.

Risk:

- Compile-time settings drift silently between the two outputs.
- A type-only change visible to one host can pass while the other host has stricter or laxer settings.
- Bundle size and source-map debugging behave differently per host.

Implementation:

```text
tsconfig.core.json    # parser, graph, info, core, workspace, docs, application
tsconfig.vscode.json  # extends core, adds src/extension, src/webview, src/mcp
tsconfig.claude.json  # extends core, adds src/claude, src/scripts
```

Acceptance:

- Each shared file is built once. Hosts compose, not duplicate.
- `npm run compile:core` succeeds standalone.

### A4. `llmem-plugin/` shadows `src/claude/`

Severity: Low-medium

Surfaced: documented in `CURRENT_STATE_2026-05-02.md` §10 ("Out of scope" for the static-review stream).

Problem:

- `llmem-plugin/` is a Claude-Code-plugin distribution format with its own `dist/cli.bundle.js` and `.mcp.json`. It overlaps the purpose of `src/claude/` and `bin/llmem`. There is no documented story for which is canonical.

Risk:

- Two distribution formats. Behavior drift. Ambiguity for users.

Implementation options:

1. Delete `llmem-plugin/` if `bin/llmem` + the VS Code extension cover all distribution channels.
2. Document `llmem-plugin/` as the canonical Claude-Code-plugin packaging and reduce `src/claude/cli.ts` to a thin wrapper.
3. Keep both but add a top-level `DISTRIBUTIONS.md` explaining when to use each.

This needs a product-ownership decision before implementation.

Acceptance:

- One canonical distribution path per host (VS Code, Claude Code plugin, raw CLI). Decision recorded in repo docs.

### Carry-over items already covered above

These items from Loops 15-17 deferreds map to existing Findings; no new sections needed:

| Carry-over | Covered by |
| --- | --- |
| Closing residual `KNOWN_VIOLATIONS` (`src/scripts/scan_codebase.ts` and `src/scripts/generate_webview.ts` -> `src/extension/config.ts`) | Findings 22, 62 |
| Production HTTP route validation (contract tests pin wire shape; production-side `parse()` was deferred) | Finding 37 |

---

## Appendix B — Loop-By-Loop Priority Plan

Continues the static-review-excellence loop numbering. Last committed loop was L17; this plan picks up at **L18**. One loop = one commit. Phases group related loops; phases run in order, but loops within a phase are independent unless `blocks` is noted.

The plan closes every Finding 1-70 plus all four carry-overs (A1-A4). Estimated total: ~32 loops.

### Phase 8 — Quick correctness and security (4 loops)

Small, high-value fixes. No architectural prerequisites.

| Loop | Subject | Closes | Notes |
| --- | --- | --- | --- |
| **L18** | HTTP `/api/regenerate` requires POST | Finding 4 | `405 Method Not Allowed` + integration tests for GET/PUT/POST. Security-critical when token is empty. |
| **L19** | Replace `new Function` markdown loader with `await import('marked')` | Finding 66 | Touches `arch-watcher.ts` and any other dynamic loaders. CSP/bundler safety. |
| **L20** | Frontend debug-log cleanup (drop content previews) | Findings 28, 14, 64 (warn) | Remove markdown value previews in `DesignTextView`; switch edge-list `save() no-op` log to debug; warn loudly when server starts with empty `apiToken`. |
| **L21** | Fix `__dirname` bug in `src/claude/web-launcher.ts` | Carry-Over A1 | Switch to injected `assetRoot`. Unblocks 3 arch-watcher integration suites. |

### Phase 9 — Workspace IO foundation (5 loops)

The single biggest safety win. Every later loop that touches FS depends on this.

| Loop | Subject | Closes | Notes |
| --- | --- | --- | --- |
| **L22** | Add `WorkspaceIO` with realpath containment | Findings 1, 2 | New `src/workspace/io.ts` with `resolve*`, `readText`, `writeText`, `mkdir`. Realpath check on existing parents; realpath check on parent for new files. Typed errors. Tests for absolute escape, `../`, symlink escape, Windows drive paths. |
| **L23** | Validating path constructors `parseRelPath` / `parseWorkspaceRoot` | Finding 54 | Replace silent `as` casts with constructors that throw on invalid shape. Keep `as*` only in low-level adapter files; arch test enforces the allowlist. |
| **L24** | Migrate `src/application/scan.ts` to WorkspaceIO | Finding 1 | Replace every `path.join(workspaceRoot, x)` with `io.resolve(...)`. **Blocks: L31.** |
| **L25** | Migrate `WatchService` and `ArchWatcherService` to WorkspaceIO | Findings 1, 38, 48 | Drop `arch-watcher.ts`'s own containment helper; drop `WatchService`'s direct fs writes. Inject scoped IO. |
| **L26** | Migrate `EdgeListStore` writes through WorkspaceIO | Finding 1 | Edge-list writes route through scoped IO. Reduces `WRITE_ALLOWLIST` further. |

After Phase 9: `WRITE_ALLOWLIST` is empty or near-empty; symlink escape tests pass; raw `path.join(workspaceRoot, x)` does not appear outside `src/workspace/`.

### Phase 10 — Application boundaries and contracts (5 loops)

| Loop | Subject | Closes | Notes |
| --- | --- | --- | --- |
| **L27** | Introduce `AppContext` and thread `artifactRoot` | Finding 3 | New `src/application/context.ts`. Update `DocumentFolderRequest` and every callsite in MCP/CLI/server/extension. |
| **L28** | Move viewer projections out of `src/webview/` | Finding 5 | `src/application/viewer-model/` with `worktree-model.ts`, `folder-status.ts`. Add arch rule: `application -> webview` forbidden. |
| **L29** | Shared config loader outside extension | Findings 22, 62 | New `src/config/{defaults,env,loader,schema}.ts`. `src/extension/config.ts` becomes a VS Code adapter. **Closes both residual `KNOWN_VIOLATIONS`.** Arch rule list expanded per Finding 62. |
| **L30** | Zod request schemas at HTTP route boundaries | Finding 37 | Each route in `src/claude/server/routes/` validates body with a schema before branding paths. Reuse `tests/contracts/http-route-dtos.test.ts` shapes. |
| **L31** | Zod request schemas at MCP tool boundaries | Finding 37 | Each tool validates `arguments` via existing Zod input schemas (already authored — wire into runtime, narrow once, brand after). |

### Phase 11 — Graph pipeline unification (5 loops)

Depends on L24 (scan.ts migrated to IO).

| Loop | Subject | Closes | Notes |
| --- | --- | --- | --- |
| **L32** | Extract scan engine; recursive scan = one load/save | Findings 6, 7, 20 | Internal units: `loadScanStores`, `collectSupportedFiles`, `scanOneFileIntoStores`, `saveScanStores`. Normalize error discipline (input missing throws; parse failure collects). Surface diagnostics. |
| **L33** | Replace viewer initial TS-only scan with registry-based scan | Findings 21, 20 | Use the L32 scan engine in `application/viewer-data.ts`. Multi-language initial graph. Add `ViewerDiagnostic[]`. |
| **L34** | `LanguageSupportProvider` replaces split extension lists | Finding 9 | Single source of truth for `extensions / runtimeAvailable / supportsImports / supportsCalls`. Used by parser registry, watch service, worktree generation. |
| **L35** | `ImportResolver` contract per language | Findings 10, 11, 52 | Move resolution out of `src/graph/artifact-converter.ts` into language-specific resolvers. Inject into `artifactToEdgeList`. Tests per language (TS extensionless, Python `from . import`, Python dotted, scoped npm packages, C++ system vs local include). |
| **L36** | `ParserRegistry` injection + logger | Findings 8, 13, 17, 40 | `createDefaultParserRegistry({ logger })`. Singleton becomes a compatibility wrapper. Move `STDLIB_FUNCTIONS` to `src/info/stdlib-filter.ts` (Finding 17). Inject loggers into `EdgeListStore`. Architecture test: production modules use `Logger`, not `console.*` (Finding 40). |

### Phase 12 — Edge storage robustness (3 loops)

| Loop | Subject | Closes | Notes |
| --- | --- | --- | --- |
| **L37** | Edge-list indexed internals (Maps), readonly getters | Finding 12 | Persisted JSON shape unchanged. Internal `Map<id, NodeEntry>` + `Map<edgeKey, EdgeEntry>`. `getNodes()`/`getEdges()` return readonly snapshots. Edge key includes `kind`. |
| **L38** | Atomic writes for artifact/state/`.arch` files | Finding 50 | `atomicWriteText(path, contents)` writes to `.tmp` then rename. Used by edge-list, watch state, arch writes. |
| **L39** | External node kind in schema; `EdgeListLoadError` UI surface; `removeFolder` snapshot fix | Findings 16, 51, 49 | Add `'external'` to `NodeKindSchema` v2 with migration of legacy `kind: 'file'` external entries. Catch `EdgeListLoadError` at MCP/HTTP/extension boundaries with actionable diagnostics. Take `[...this.watchedFiles]` snapshot before `removeFile` loop. |

### Phase 13 — Frontend component health (6 loops)

Independent of Phases 9-12. Can run in parallel with them.

| Loop | Subject | Closes | Notes |
| --- | --- | --- | --- |
| **L40** | Split `DesignTextView` | Findings 25, 19 | `src/webview/ui/design/{DesignDocLookup,DesignDocEditorController,DesignEmptyState}.ts` and `designDocKeys.ts`. Also extract `document-file`/`document-folder` prompt templates into `src/application/document/prompts/` (Finding 19) since the data-side keys land in the same loop. |
| **L41** | Browser-safe shared design-doc key module | Findings 26, 39 | New `src/common/design-doc-keys.ts` (no Node imports). Backend `docs/arch-store.ts` and `arch-watcher` wrap it. Centralize markdown rendering and sanitization split (Finding 39). |
| **L42** | Worktree index replaces DOM scans | Findings 29, 32, 18 | Build `WorktreeIndex { filesByFolder, nodeByPath }` after worktree load. Folder/descendant checks read the index. `GraphRenderer` keeps `currentNodes: Map<id, VisNode>`. Fix `document-folder` file-count edge case (Finding 18). |
| **L43** | Component lifecycle idempotency | Finding 24 | `mount()` calls `unmount()` first. Subscriptions and `theme-changed` listeners are dispose-tracked. Tests: mount twice -> single subscription. |
| **L44** | Notification state replaces `alert()` | Findings 30, 70 | `AppNotification` in state; nonblocking inline toast. Status-dot tooltips/labels. |
| **L45** | Type window globals; remove `as any`; folder-request keying | Findings 27, 36, 41 (frontend portion), 55, 56 | `globals.d.ts` for `window.GRAPH_DATA` etc. Add `triggerSave()`/`fetchDesignDoc()` to DataProvider interface. Key `pendingFolderNodeRequests` by request ID like watch toggles. Add `dataReady` timeout / error state. |

### Phase 14 — Folder/build structure (3 loops)

| Loop | Subject | Closes | Notes |
| --- | --- | --- | --- |
| **L46** | `src/claude/` per-deliverable subfolder split | Carry-Over A2 | Move to `src/claude/{mcp,server,launcher,cli}/`. Add cross-sub arch rules. |
| **L47** | Shared core tsconfig | Carry-Over A3 | New `tsconfig.core.json`. `tsconfig.vscode.json` and `tsconfig.claude.json` extend it. Each shared file builds once. |
| **L48** | `llmem-plugin/` vs `src/claude/` resolution | Carry-Over A4 | Decision + execution: delete, document, or normalize. Needs product-ownership input. |

### Phase 15 — Type quality and lint discipline (3 loops)

| Loop | Subject | Closes | Notes |
| --- | --- | --- | --- |
| **L49** | `any` audit across HTTP/extension/graph/webview transform | Findings 41, 15 | Replace `any` in HTTP `sendJson`, panel message handler, `transformGraphsToVisData`. Use `unknown` at boundaries, narrow with schemas. |
| **L50** | Browser-purity transitive closure check | Finding 63 | `tests/arch/browser-purity.test.ts` builds a module graph from webview UI entrypoints and walks transitively. Direct scanner stays as fast first line. |
| **L51** | ESLint promotion to error for production code | Finding 61 | `no-explicit-any` and `no-require-imports` -> error in `src/`, warn in `tests/`/`scripts/`. |

### Phase 16 — Polish (3 loops, low priority)

| Loop | Subject | Closes | Notes |
| --- | --- | --- | --- |
| **L52** | Extension panel and hot-reload split | Findings 42, 43 | Decompose `src/extension/panel.ts` into `panel/{LLMemPanel,panelMessages,panelDataController,panelWatchController,panelGraphController}.ts`. Same for hot-reload. Inject loggers. |
| **L53** | Server-side polish | Findings 44, 45, 46, 47, 65 | `RegenerationCoordinator` queue. Settled-guard in `readRequestBody`. Explicit URL-decode handling in static handler. `startServer` accepts `ServerConfig`. Convert sync FS to async in handler. |
| **L54** | Naming, scripts, vendored libs, router | Findings 31, 34, 53, 58, 60, 67, 68, 69 | Standardize `webview` (not `web-viewer`) in `tests/unit/`. Document or rename `package.json` script set. Vendor `Splitter.ts` to `vendor/` or document provenance. Rename router to `ViewStateGuard` or delete. Move stable inline styles to CSS modules. |

### Loop count rollup

| Phase | Loops | Range |
| --- | --- | --- |
| 8. Quick correctness | 4 | L18-L21 |
| 9. Workspace IO | 5 | L22-L26 |
| 10. App boundaries / contracts | 5 | L27-L31 |
| 11. Graph pipeline | 5 | L32-L36 |
| 12. Edge storage | 3 | L37-L39 |
| 13. Frontend health | 6 | L40-L45 |
| 14. Folder/build | 3 | L46-L48 |
| 15. Type/lint | 3 | L49-L51 |
| 16. Polish | 3 | L52-L54 |
| **Total** | **37** | **L18-L54** |

### Cut lines

If scope must shrink, cut from the bottom up. Phases 8-12 are the safety/correctness core. Phase 13 is a coherent frontend rewrite. Phases 14-16 are quality and ergonomics.

- **Stop at L39**: workspace + boundary + contract + graph + storage all closed. The dangerous half of the codebase is fixed.
- **Stop at L45**: above plus frontend health. The system feels production-grade.
- **Stop at L48**: above plus structural cleanup (folders, tsconfig). Only polish remains.

### Findings -> Loops index

| Finding | Loop | Finding | Loop | Finding | Loop |
| --- | --- | --- | --- | --- | --- |
| 1  | L22, L24-L26 | 24 | L43          | 47 | L53 |
| 2  | L22          | 25 | L40          | 48 | L25 |
| 3  | L27          | 26 | L41          | 49 | L39 |
| 4  | L18          | 27 | L45          | 50 | L38 |
| 5  | L28          | 28 | L20          | 51 | L39 |
| 6  | L32          | 29 | L42          | 52 | L35 |
| 7  | L32          | 30 | L44          | 53 | L54 (defer) |
| 8  | L36          | 31 | L54          | 54 | L23 |
| 9  | L34          | 32 | L42          | 55 | L45 |
| 10 | L35          | 33 | (none — defer; targeted perf) | 56 | L45 |
| 11 | L35          | 34 | L54          | 57 | L45 |
| 12 | L37          | 35 | L41          | 58 | L54 |
| 13 | L36          | 36 | L45          | 59 | (covered by L32+L33) |
| 14 | L20          | 37 | L30, L31     | 60 | L54 |
| 15 | L49          | 38 | L25          | 61 | L51 |
| 16 | L39          | 39 | L41          | 62 | L29 |
| 17 | L36          | 40 | L36          | 63 | L50 |
| 18 | L42          | 41 | L45, L49     | 64 | L20 |
| 19 | L40          | 42 | L52          | 65 | L53 |
| 20 | L32, L33     | 43 | L52          | 66 | L19 |
| 21 | L33          | 44 | L53          | 67 | (resolved by L17) |
| 22 | L29          | 45 | L53          | 68 | L54 |
| 23 | (resolved by L17) | 46 | L53      | 69 | L54 |
|                  |                  | 70 | L44 |

Carry-overs A1 -> L21; A2 -> L46; A3 -> L47; A4 -> L48.

### Definition of Done (rolled up)

A loop is complete when:

- One commit lands the change.
- All gates from `STATIC_REVIEW_IMPLEMENTATION_SPEC_2026-05-02.md` (build, lint, all four test suites) pass.
- Acceptance criteria from the corresponding finding(s) are met.
- The loop's `IMPLEMENTATION.md` documents any deviation from PLAN.md.
- The loop's `TEST.md` returns `ready: yes` from work-tester.

The full plan is complete when:

- All 70 findings are closed (or explicitly deferred with owner/date).
- All 4 carry-overs are closed.
- KNOWN_VIOLATIONS.length = 0.
- `npm test` runs cleanly with no skipped suites due to environmental bugs (A1 fixed in L21).
- One canonical scan engine is used by viewer/CLI/server/extension paths.
