# Codebase Quality Implementation Plan - 2026-05-05

## Purpose

This document turns the 2026-05-05 static review into an implementation plan.
The goal is to move LLMem from a good mid-migration codebase to an excellent
one: consistent host behavior, clean architectural boundaries, durable
workspace containment, smaller frontend modules, and explicit contracts between
backend, MCP, parser, graph, and webview layers.

Tests are assumed passing at the start of this plan. The plan is static-review
driven and should be executed as small, independently reviewable changes.

## Quality Target

Target grade: A- or better.

Success means:

- VS Code and standalone webview modes render from the same structural
  contract.
- Every workspace read/write that can touch user files flows through a single
  realpath-strong workspace context.
- All configured roots, especially `artifactRoot`, are honored across CLI,
  server, extension, MCP, and application services.
- Browser code imports only browser-safe contracts.
- Mutating HTTP routes share one method, origin, auth, and JSON-body contract.
- Parser behavior is deterministic for TypeScript module resolution and
  caller-supplied content.
- Large frontend modules are decomposed into typed, testable units.
- Architecture allowlists shrink instead of growing.

## Current State

### Strengths

- The repository has clear top-level areas:
  - `src/application`: workflow orchestration.
  - `src/claude`: CLI and local graph server.
  - `src/extension`: VS Code/Antigravity host integration.
  - `src/mcp`: MCP server and tool handlers.
  - `src/parser`: language adapters and extractors.
  - `src/graph`: edge-list, folder-tree, graph projection logic.
  - `src/webview`: static generator and browser UI.
  - `src/workspace`: safer filesystem primitives.
- Static architecture tests already cover dependency direction, browser purity,
  HTML safety, graph IDs, path containment, and console discipline.
- `WorkspaceIO` is a strong abstraction and should become the mandatory
  filesystem boundary.
- Graph artifacts increasingly use versioned schemas and explicit migration.
- Application services such as `scan`, `toggle-watch`, `document-file`, and
  `document-folder` show the right direction: host-specific code delegates to
  reusable workflows.

### Main Quality Gaps

1. The VS Code panel HTML is structurally behind `src/webview/index.html`.
   It lacks mount points and assets for package/folder views, while the
   browser entrypoint mounts those components unconditionally.

2. `VSCodeDataProvider.loadFolderTree()` and `loadFolderEdges()` explicitly
   say the extension-host handlers are not wired, yet `PackageView` is mounted
   in all modes.

3. Several services claim `WorkspaceIO` hardening but still construct stores
   without passing `io`, falling back to raw filesystem paths.

4. `document-folder` hardcodes `.artifacts`, ignoring configured artifact
   roots.

5. Mutating HTTP routes do not share a common security middleware. The
   same-origin CSRF gate exists for `/api/regenerate` but not for `/api/watch`
   or POST `/api/arch`.

6. TypeScript import resolution uses a fragile symbol lookup and has an empty
   fallback. The extractor also accepts `content` but effectively ignores it.

7. The frontend has several god modules and ad hoc `any`-based layout mutation:
   `PackageView`, `HierarchicalLayout`, `GraphRenderer`, `Worktree`,
   `DesignTextView`.

8. Browser code contains excessive debug logging, including saved markdown
   previews/content.

9. Architecture tests encode transitional allowlists. They are useful, but
   they should become a burn-down list.

## Proposed End State

### Core Architecture

Introduce a shared workspace runtime object:

```ts
interface WorkspaceContext {
    workspaceRoot: WorkspaceRoot;
    artifactRoot: AbsPath;
    artifactRootRel: RelPath;
    archRoot: AbsPath;
    archRootRel: RelPath;
    io: WorkspaceIO;
    config: RuntimeConfig;
    logger: Logger;
}
```

This context is created once per workspace in each host:

- CLI command context.
- Claude graph server startup.
- VS Code panel startup.
- MCP server/tool initialization.

Application services should receive `WorkspaceContext` or a smaller derived
interface instead of parallel `workspaceRoot`, `artifactRoot`, `io`, `logger`
arguments.

### Contract Layout

Split browser-safe DTOs and schemas from Node builders:

```text
src/contracts/
  edge-list.ts
  folder-tree.ts
  folder-edges.ts
  viewer-data.ts
  watch.ts
  http.ts
```

Node-only modules may import contracts. Browser modules may import contracts.
Contracts must not import `fs`, `path`, `vscode`, `chokidar`, `tree-sitter`, or
server-only modules.

### Webview Host Model

Use one HTML shell contract for static and VS Code modes:

- Static mode writes data scripts and loads assets from relative paths.
- VS Code mode rewrites the same shell with `webview.asWebviewUri`, nonce, and
  CSP.
- Component mount points are identical in both modes.
- Host-specific behavior lives only in `DataProvider` implementations.

## Implementation Phases

### Phase 1 - Stabilize Webview Host Parity

Objective: make VS Code and standalone modes use the same UI structure.

Work:

1. Create a webview shell renderer, for example `src/webview/shell.ts`.
   It should own:
   - Required CSS files.
   - Required JS files.
   - Required mount points.
   - Optional CSP/nonce/URI rewriting hooks.

2. Replace hand-written HTML in `src/extension/panel.ts` with the shell
   renderer.

3. Ensure the VS Code shell includes:
   - `#view-toggle`
   - `#design-mode-toggle`
   - `#package-view`
   - `#folder-structure-view`
   - `styles/folder-structure.css`
   - `libs/vis-network.min.js`

4. Make `main.ts` validate required DOM elements before constructing
   components. A missing required element should render a clear initialization
   error instead of relying on type assertions.

5. Add panel-side handlers for:
   - `loadFolderTree`
   - `loadFolderEdges`

6. Add or update static tests:
   - VS Code shell contains all static shell mount points.
   - `VSCodeDataProvider.loadFolderTree()` resolves when panel echoes
     `data:folderTree`.
   - `VSCodeDataProvider.loadFolderEdges()` resolves when panel echoes
     `data:folderEdges`.

Acceptance:

- No "not yet wired" comments remain in `vscodeDataProvider.ts`.
- Package and folder views can load in VS Code mode.
- Static and VS Code shell drift is covered by tests.

### Phase 2 - Introduce WorkspaceContext

Objective: remove repeated root plumbing and raw fallback ambiguity.

Work:

1. Add `src/application/workspace-context.ts`.

2. Define:
   - `RuntimeConfig`
   - `WorkspaceContext`
   - `createWorkspaceContext(input)`
   - helper accessors for artifact and arch relative paths.

3. Update creation sites:
   - `src/claude/cli/context.ts`
   - `src/claude/server/index.ts`
   - `src/extension/panel.ts`
   - `src/mcp/server.ts` or MCP tool shared helpers.

4. Update stores and services to accept context-derived values.

5. Remove repeated `WorkspaceIO.create(...)` calls inside hot paths such as
   panel message handlers and watch toggles.

Acceptance:

- A grep for repeated `WorkspaceIO.create` should show only context factories
  and focused tests.
- Application services no longer need to reconstruct roots from strings.

### Phase 3 - Make WorkspaceIO Mandatory For Artifact Stores

Objective: eliminate raw filesystem fallback paths from active graph and watch
state stores.

Work:

1. Change constructors for active stores to require `WorkspaceIO`:
   - `ImportEdgeListStore`
   - `CallEdgeListStore`
   - `FolderTreeStore`
   - `FolderEdgelistStore`
   - `WatchService`

2. If legacy free functions must stay, isolate them behind explicit
   `unsafeLegacy*` names and mark them test-only or deprecated.

3. Update all active callers:
   - `application/viewer-data.ts`
   - `application/document-folder.ts`
   - `extension/panel.ts`
   - server routes
   - CLI commands
   - webview generator
   - scripts that remain supported

4. Remove stale allowlist entries from `tests/arch/workspace-paths.test.ts`.

Acceptance:

- Store load/save paths always use `WorkspaceIO`.
- Architecture write allowlists shrink.
- Comments saying "L24/L25/L26 will thread io later" are removed or updated.

### Phase 4 - Honor Artifact Root Everywhere

Objective: configured artifact roots behave consistently.

Work:

1. Update `DocumentFolderRequest` to include artifact root or full
   `WorkspaceContext`.

2. Replace hardcoded `.artifacts` in `document-folder`.

3. Audit all references to `.artifacts`:
   - Keep constants/defaults in config modules.
   - Remove workflow-level hardcoding.

4. Add contract/integration tests:
   - MCP `folder_info` reads from custom artifact root.
   - CLI `scan` + `document folder` honors custom artifact root.
   - Server `serve --artifact-root` or env equivalent uses the same root for
     artifacts and webview data.

Acceptance:

- A grep for `'.artifacts'` in workflow code should only find defaults,
  docs, tests, and migration compatibility code.

### Phase 5 - Shared HTTP Route Middleware

Objective: every mutating HTTP route has the same security and parsing posture.

Work:

1. Add route helpers, for example `src/claude/server/routes/middleware.ts`:
   - `requireMethod(req, res, methods)`
   - `requireSameOrigin(req, res, options)`
   - `requireApiToken(req, res, ctx)`
   - `readJsonBody(req, schema, opts)`

2. Apply to:
   - POST `/api/regenerate`
   - POST/DELETE `/api/watch`
   - POST `/api/arch`

3. Keep GET routes unauthenticated unless they expose sensitive data beyond
   local workspace expectations.

4. Add tests mirroring existing regenerate origin tests for watch and arch.

Acceptance:

- Origin gate logic is implemented once.
- Mutating routes all reject cross-origin browser requests when `Origin` is
  present and mismatched.
- Existing token behavior remains unchanged.

### Phase 6 - Parser Contract Cleanup

Objective: make parser outputs predictable and easier to trust.

Work:

1. Clarify `ArtifactExtractor.extract(filePath, content?)` semantics.
   Choose one:
   - Either all extractors must honor `content`.
   - Or remove `content` from the interface and add a separate
     `extractContent` API.

2. For TypeScript:
   - Use compiler module resolution APIs for imports.
   - Support `paths`, `baseUrl`, package exports, index files, JS/TS
     extension mixing, and re-exports.
   - Use supplied content through an in-memory compiler host when present.

3. Remove dead methods from `ts-service.ts` such as unused manual enum parsers.

4. Add parser tests:
   - TS path aliases.
   - Index import resolution.
   - Re-export resolution.
   - `content` extraction for unsaved code.
   - External module remains external.

Acceptance:

- No empty fallback remains in import resolution.
- Parser tests document exact expected `resolvedPath` behavior.

### Phase 7 - Frontend Module Decomposition

Objective: reduce component size and improve testability.

Work:

1. Split `PackageView` into:
   - `PackageView`
   - `FolderCardList`
   - `FolderArcNetwork`
   - `FolderDescriptionPanel`
   - `EdgeDrilldownPanel`
   - `folderViewModel.ts`

2. Split layout data types out of `HierarchicalLayout`:
   - `MeasuredNode`
   - `FolderBlock`
   - `PositionedNode`
   - `LayoutComputation`

3. Replace `(node as any)._x` style mutation with explicit maps or enriched
   layout records.

4. Extract `Worktree` rendering helpers:
   - tree HTML renderer
   - watch-state calculator
   - expansion-state persistence

5. Keep DOM event delegation at component boundaries.

Acceptance:

- No `as any` layout scratch fields remain.
- `PackageView.ts` becomes an orchestration component, not the whole feature.
- New units have focused tests around pure view-model behavior.

### Phase 8 - Browser Logging And Error Hygiene

Objective: remove debug noise and accidental content leaks.

Work:

1. Add browser logger:

```ts
export const webviewLog = createWebviewLogger({
    enabled: Boolean(window.LLMEM_DEBUG),
});
```

2. Replace direct browser `console.*` with logger calls where useful.

3. Remove logs that print:
   - full markdown
   - source content
   - arbitrary design doc payloads
   - large graph data

4. Keep error displays escaped and user-visible where appropriate.

5. Add architecture/static test:
   - no direct `console.log` in `src/webview/ui/**` except logger module.
   - no `markdown preview` or `Content to save` logging strings.

Acceptance:

- Browser console is quiet by default.
- Saved document content is never printed.

### Phase 9 - Burn Down Architecture Allowlists

Objective: turn current transitional tests into durable constraints.

Work:

1. `tests/arch/browser-purity.test.ts`
   - Move graph DTOs/schemas to browser-safe contracts.
   - Remove type-only graph imports from known violations.

2. `tests/arch/dependencies.test.ts`
   - Move runtime config out of `src/extension/config.ts`.
   - Remove script-to-extension config violations.

3. `tests/arch/workspace-paths.test.ts`
   - Require `WorkspaceIO` for graph/artifact/watch stores.
   - Remove direct write fallback violations.

4. `tests/arch/console-discipline.test.ts`
   - Extend browser logging discipline after the webview logger lands.

Acceptance:

- Known-violation lists shrink materially after each phase.
- New exceptions require a linked issue or plan entry and an expiration phase.

## Suggested Execution Order

1. Phase 1: Webview host parity.
2. Phase 5: Shared route middleware.
3. Phase 2: WorkspaceContext.
4. Phase 3: Mandatory WorkspaceIO for stores.
5. Phase 4: Artifact root consistency.
6. Phase 6: Parser contract cleanup.
7. Phase 8: Browser logging cleanup.
8. Phase 7: Frontend decomposition.
9. Phase 9: Architecture allowlist burn-down.

Reasoning:

- Webview parity fixes visible broken behavior first.
- Route middleware is small and high value.
- WorkspaceContext should land before broad IO and artifact-root cleanup to
  avoid repeated churn.
- Parser and frontend decomposition are larger and safer once contracts are
  stable.

## Verification Strategy

Do not rely only on unit tests. Each phase should have three verification
layers:

1. Static/architecture tests for boundaries.
2. Unit tests for pure logic and DTO/schema contracts.
3. Integration tests for host behavior:
   - CLI
   - local server
   - VS Code provider/panel message protocol where feasible.

Manual smoke checks after major phases:

- `llmem scan`
- `llmem serve`
- static webview loads graph, packages, folders, design docs.
- VS Code panel loads the same views.
- toggling a file updates watched state and graph data.
- editing a design doc updates `.arch`.

## Risk Register

### Shell Unification Risk

Risk: VS Code CSP/URI rewriting can break static mode if the template is too
coupled to one host.

Mitigation: shell renderer should be pure and parameterized. Static and VS Code
tests should snapshot only structural invariants, not volatile nonces.

### WorkspaceContext Migration Risk

Risk: broad signature changes can create large noisy diffs.

Mitigation: introduce context adapters first, migrate one subsystem at a time,
and keep compatibility overloads only for one phase.

### Store Constructor Breakage

Risk: requiring `WorkspaceIO` touches many call sites.

Mitigation: migrate in two steps:

1. Add `fromContext` factories and update callers.
2. Remove unsafe constructors after all callers move.

### Parser Behavior Changes

Risk: better TypeScript resolution may alter graph edges.

Mitigation: add fixture tests before changing implementation. Make changed
edge behavior explicit in snapshots.

### Frontend Refactor Risk

Risk: component split can regress interactions.

Mitigation: first extract pure view-model functions under current tests, then
split DOM components.

## Definition Of Done

This implementation plan is complete when:

- VS Code and static webview shell contracts are unified.
- Package/folder views work in both hosts.
- Active graph/artifact/watch stores cannot save/load without `WorkspaceIO`.
- All application workflows honor configured artifact roots.
- Mutating HTTP routes share method, origin, auth, and body validation helpers.
- TypeScript parser import resolution is tested and robust.
- Browser logs are quiet and do not leak content.
- Large frontend modules are decomposed around explicit DTOs.
- Architecture allowlists have been reduced and documented as temporary only
  where they remain.

At that point the expected codebase grade is A-.
