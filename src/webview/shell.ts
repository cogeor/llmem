/**
 * Webview shell renderer — the single source of truth for the host HTML.
 *
 * Both the static generator (`src/webview/generator.ts`) and the VS Code
 * panel (`src/extension/panel.ts`) call `renderShell()` so neither host can
 * drift on stylesheets, library tags, or mount-point IDs. Hosts supply only
 * the URI-resolution hooks (and a CSP + nonce in the VS Code case).
 *
 * Browser purity: this module is pure string assembly over the asset
 * manifest in `./shell-assets.ts` — no `fs`, `path`, `vscode`, or other
 * Node-only imports. (`tests/arch/browser-purity.test.ts` only scans
 * `src/webview/ui/**`, but we keep this file pure on principle so it
 * remains safe to import from either side of the host boundary.)
 *
 * Loop 01 closed the legacy gap where the VS Code shell was missing
 * `#view-toggle` (under a hidden placeholder), `#design-mode-toggle`,
 * `#package-view`, `#folder-structure-view`, `styles/folder-structure.css`,
 * and `libs/vis-network.min.js`. Anything added to the shell goes through
 * `MOUNT_POINTS` / `STYLESHEETS` / `LIBS` in `shell-assets.ts`.
 */

import { STYLESHEETS, LIBS, MAIN_SCRIPT } from './shell-assets';

/**
 * Host-supplied URI resolution hooks. Each `resolve*` takes a repo-relative
 * posix path (matching `STYLESHEETS` / `LIBS` / `MAIN_SCRIPT` in
 * `shell-assets.ts`) and returns the absolute URL the host wants emitted
 * into the HTML.
 *
 * - Static generator: identity functions (relative URLs work because
 *   `index.html` sits next to `styles/`, `libs/`, and `js/`).
 * - VS Code panel: each hook calls `webview.asWebviewUri(joinPath(...))` to
 *   produce a `vscode-webview://...` URL, plus a CSP string and a per-render
 *   nonce so script tags are allow-listed.
 */
export interface ShellHostHooks {
    resolveStyle(rel: string): string;
    resolveLib(rel: string): string;
    resolveScript(rel: string): string;
    /** Optional CSP — emitted as a `<meta http-equiv>` tag when set. */
    csp?: string;
    /** Optional script nonce — applied to every emitted `<script>` tag. */
    nonce?: string;
}

/** Options passed to `renderShell`. */
export interface ShellOptions {
    hooks: ShellHostHooks;
    /** Page `<title>`; defaults to `"Project View"`. */
    title?: string;
    /**
     * Optional pre-data scripts emitted before the main bundle. Static mode
     * passes `['graph_data.js', 'work_tree.js', 'design_docs.js',
     * 'folder_tree.js', 'folder_edges.js']` (or the graph-only subset).
     * VS Code passes `[]` because data flows over `postMessage`.
     */
    dataScriptUrls?: readonly string[];
}

/**
 * Render the host HTML document. The output is the full
 * `<!DOCTYPE html>...</html>` string the host writes/serves.
 *
 * Body order — pinned by the parity test in
 * `tests/arch/webview-shell-parity.test.ts`:
 *   1. `<div id="view-toggle">` directly under `<body>` (above `#app`).
 *   2. `<div id="app">` containing explorer / splitter-1 / design /
 *      splitter-2 / graph panes with their toolbar + content mounts.
 *   3. Library `<script>` tags from `LIBS` (with `nonce` if set).
 *   4. Optional data-script tags from `opts.dataScriptUrls` (with `nonce`
 *      if set; classic, non-module, no `type="module"` — the bundle uses
 *      IIFE for `file://` compatibility).
 *   5. Main bundle script (with `nonce` if set).
 */
export function renderShell(opts: ShellOptions): string {
    const { hooks, title = 'Project View', dataScriptUrls = [] } = opts;
    const nonceAttr = hooks.nonce ? ` nonce="${hooks.nonce}"` : '';

    const cspMeta = hooks.csp
        ? `<meta http-equiv="Content-Security-Policy" content="${hooks.csp}">`
        : '';

    const styleTags = STYLESHEETS
        .map((rel) => `<link rel="stylesheet" href="${hooks.resolveStyle(rel)}">`)
        .join('\n    ');

    const libTags = LIBS
        .map((rel) => `<script${nonceAttr} src="${hooks.resolveLib(rel)}"></script>`)
        .join('\n    ');

    const dataScriptTags = dataScriptUrls
        .map((rel) => `<script${nonceAttr} src="${rel}"></script>`)
        .join('\n    ');

    const mainScriptTag = `<script${nonceAttr} src="${hooks.resolveScript(MAIN_SCRIPT)}"></script>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${cspMeta}
    <title>${title}</title>
    ${styleTags}
</head>
<body>
    <!-- Loop 16: tri-state route toggle (Graph / Design / Packages). Mounted
         by main.ts via the ViewToggle component. -->
    <div id="view-toggle" class="view-toggle-host"></div>
    <div id="app" class="layout-row">
        <!-- Explorer Pane -->
        <div id="explorer-pane" class="pane" style="width: 250px;">
            <div class="pane-header">
                <span class="pane-title" id="explorer-title"><span class="pane-icon"></span></span>
                <div class="toolbar">
                    <button id="theme-toggle" class="icon-btn" title="Toggle Theme">☀️</button>
                </div>
            </div>
            <div class="pane-content" id="worktree-root"></div>
        </div>

        <!-- Splitter 1 -->
        <div class="splitter" id="splitter-1"></div>

        <!-- Design Pane -->
        <div id="design-pane" class="pane" style="flex: 1;">
            <div class="pane-header">
                <span class="pane-title" id="design-title"><span class="pane-icon"></span></span>
                <div class="toolbar">
                    <div id="design-mode-toggle"></div>
                </div>
            </div>
            <div class="pane-content">
                <div id="design-view" class="detail-view"></div>
            </div>
        </div>

        <!-- Splitter 2 -->
        <div class="splitter" id="splitter-2"></div>

        <!-- Graph Pane -->
        <div id="graph-pane" class="pane" style="flex: 1;">
            <div class="pane-header">
                <span class="pane-title" id="graph-title"><span class="pane-icon"></span></span>
                <div class="toolbar">
                    <div id="graph-type-toggle"></div>
                </div>
            </div>
            <div class="pane-content graph-pane-content">
                <div id="graph-view" class="graph-container">
                    <div class="graph-canvas"></div>
                </div>
                <!-- PackageView mount point (cards + arcs, memo/design/02 second half). -->
                <div id="package-view" style="display: none; width: 100%; height: 100%; overflow: auto;"></div>
                <!-- FolderStructureView mount point (orthogonal folder graph, memo/design/02 first half). -->
                <div id="folder-structure-view" style="display: none; width: 100%; height: 100%; overflow: auto;"></div>
            </div>
        </div>
    </div>

    ${libTags}
    ${dataScriptTags}
    ${mainScriptTag}
</body>
</html>`;
}
