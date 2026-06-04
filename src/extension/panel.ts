/**
 * Webview panel — barrel (Loop 15 split).
 *
 * The former ~560-line monolith was carved into the `panel/` sibling
 * directory; this file is now a THIN barrel that re-exports the public
 * surface so existing import sites (`from './panel'`) keep working
 * UNCHANGED. The only production importer is `extension.ts`, which imports
 * `LLMemPanel`.
 *
 * Layout of the carved units:
 *   - `panel/panel-controller.ts`       — the `LLMemPanel` class shell
 *                                         (lifecycle + state + PanelHost impl).
 *   - `panel/panel-message-router.ts`   — the webview→panel message switch.
 *   - `panel/panel-data-handlers.ts`    — folder-nodes / tree / edges lazy
 *                                         loaders (preserving the dynamic
 *                                         import of `graph/edgelist`).
 *   - `panel/panel-watch-handlers.ts`   — toggle-watch + hot-reload init /
 *                                         initial-data send (preserving the
 *                                         dynamic import of `worktree-state`).
 *   - `panel/panel-html.ts`             — webview shell HTML + nonce.
 *   - `panel/panel-markdown-renderer.ts`— raw-markdown → DesignDoc rendering.
 *   - `panel/panel-host.ts`             — the narrow controller↔handlers seam.
 *
 * NOTE: this surface legitimately imports `vscode` + the webview shell —
 * the extension is a platform surface, and those edges are allowed.
 *
 * Module-resolution note: a sibling `panel.ts` FILE takes precedence over
 * the `panel/` DIRECTORY for `import ... from './panel'`, so this barrel
 * stays the single authoritative entry point.
 */

export { LLMemPanel } from './panel/panel-controller';
