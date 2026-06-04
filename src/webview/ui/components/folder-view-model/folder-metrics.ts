/**
 * Folder metrics — browser-pure folder-path derivation (Loop 15 split).
 *
 * Carved verbatim from the former `folderViewModel.ts` monolith: `folderOf`,
 * the browser-pure mirror of `src/graph/folder-edges.ts:101-105`.
 *
 * Browser-pure: function-only, no `window.*`, `document.*`, `node:*`, or
 * `vscode` imports. Re-exported through the `folderViewModel.ts` barrel.
 */

// ---------------------------------------------------------------------------
// folderOf — browser-pure mirror of src/graph/folder-edges.ts:101-105.
//
// Rules (mirrored from the canonical impl):
//   1. Replace all backslashes with forward slashes.
//   2. Find the last forward slash; the folder is everything before it.
//   3. If there's no slash (top-level file), folder is '.'.
//
// The browser bundle cannot drag in `node:path`, so this is an
// intentional duplicate. Parity is pinned by
// tests/unit/web-viewer/folder-view-model.test.ts against
// `path.posix.dirname` for the relative-path domain that FolderEdge
// endpoints inhabit.
// ---------------------------------------------------------------------------

export function folderOf(fileId: string): string {
    const normalized = fileId.replaceAll('\\', '/');
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash === -1) return '.';
    return normalized.slice(0, lastSlash);
}
