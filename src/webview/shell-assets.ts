/**
 * Canonical asset manifest for the LLMem webview shell.
 *
 * Owned jointly by the static generator (`src/webview/generator.ts`) and the
 * VS Code panel (`src/extension/panel.ts`) so neither host can drift on which
 * stylesheets, libraries, or mount points must exist. The shell renderer in
 * `src/webview/shell.ts` consumes this manifest verbatim; both hosts call
 * `renderShell()` and supply only the URI-resolution hooks (and CSP/nonce in
 * the VS Code case).
 *
 * This module is pure data — no `fs`, `path`, or `vscode` imports — so it is
 * safe to bundle into the browser (the webview shell tests cross-check the
 * IDs by import too). The string entries are repo-relative posix paths under
 * `<webview-root>/` (i.e. relative to whichever host serves the asset),
 * because the static generator copies `styles/` and `libs/` next to the
 * generated `index.html` and the VS Code panel resolves the same paths
 * through `webview.asWebviewUri(joinPath(distWebview, ...))`.
 */

/**
 * Stylesheet hrefs in load order. Order matters — `layout.css` builds on
 * `base.css` cascades, `tree.css`/`detail.css`/`graph.css` build on layout,
 * and `folder-structure.css` is the last layer (loop 17 / FolderStructureView).
 */
export const STYLESHEETS: readonly string[] = [
    'styles/base.css',
    'styles/layout.css',
    'styles/tree.css',
    'styles/detail.css',
    'styles/graph.css',
    'styles/folder-structure.css',
] as const;

/**
 * JS libraries loaded as classic `<script>` tags before the main bundle.
 * `vis-network.min.js` is needed by `PackageView` for the folder-arc network
 * and was missing from the VS Code shell prior to loop 01.
 */
export const LIBS: readonly string[] = [
    'libs/vis-network.min.js',
] as const;

/**
 * Default static-mode main script path. The static generator emits an IIFE
 * bundle at `<dest>/js/main.js` and the host hook returns this string
 * unchanged. The VS Code host overrides via its own `resolveScript` hook to
 * point at `dist/webview/main.js` through `webview.asWebviewUri`.
 */
export const MAIN_SCRIPT = 'js/main.js' as const;

/**
 * Required mount-point IDs that must be present in the rendered shell, in
 * the order they appear in the layout. The shell parity test in
 * `tests/arch/webview-shell-parity.test.ts` asserts every entry below is
 * present in BOTH the static and VS Code outputs — this is the regression
 * alarm if a future loop drops or renames an ID in only one host.
 *
 * Order in this list mirrors the visual layout: top-level toggle, app
 * shell with its three panes (explorer / design / graph), and the toolbar
 * mount points inside each pane.
 */
export const MOUNT_POINTS: readonly string[] = [
    'view-toggle',
    'app',
    'explorer-pane',
    'worktree-root',
    'theme-toggle',
    'splitter-1',
    'design-pane',
    'design-mode-toggle',
    'design-view',
    'splitter-2',
    'graph-pane',
    'graph-type-toggle',
    'graph-view',
    'package-view',
    'folder-structure-view',
] as const;
