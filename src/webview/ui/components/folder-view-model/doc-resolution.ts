/**
 * Doc resolution — browser-pure design-doc lookups (Loop 15 split).
 *
 * Carved verbatim from the former `folderViewModel.ts` monolith:
 * `readmeKeyCandidates`, `resolveReadmeDoc`, and the parent-walking
 * `resolveClosestDoc`.
 *
 * Browser-pure: function-only, no `window.*`, `document.*`, `fetch`,
 * `node:*`, or `vscode` imports. Re-exported through the
 * `folderViewModel.ts` barrel.
 */

import type { DesignDoc } from '../../types';

// ---------------------------------------------------------------------------
// README key candidates — directory-branch of DesignTextView.fetchDesignDoc.
// ---------------------------------------------------------------------------

/**
 * Probe order for a folder's README in `designDocs`:
 *   1. `<path>/README.html`  — output of the .md → .html converter pipeline
 *   2. `<path>/README.txt`   — plain-text fallback some hosts emit
 *   3. `<path>/README.md`    — original markdown
 *
 * Same order as `DesignTextView.fetchDesignDoc:466-475`.
 */
export function readmeKeyCandidates(folderPath: string): string[] {
    return [
        `${folderPath}/README.html`,
        `${folderPath}/README.txt`,
        `${folderPath}/README.md`,
    ];
}

/**
 * First-hit lookup of a folder's README in a `designDocs` map.
 * Returns `null` (not `undefined`) on miss — callers can rely on a
 * single `=== null` guard.
 */
export function resolveReadmeDoc(
    designDocs: Record<string, DesignDoc>,
    folderPath: string,
): DesignDoc | null {
    for (const key of readmeKeyCandidates(folderPath)) {
        const doc = designDocs[key];
        if (doc !== undefined) return doc;
    }
    return null;
}

// ---------------------------------------------------------------------------
// resolveClosestDoc — pure parent-walk doc lookup.
//
// Ported from the runtime parent-walk in
// `src/webview/ui/services/designDocService.ts:9-64` (the fetch fallback was
// removed in VS-B2, so this is bundle-only — no window/fetch). It is the data
// source VS-A3 uses to render exact-vs-ancestor doc context.
//
// Algorithm, per the source:
//   1. Normalize backslashes → '/'.
//   2. For files, strip the final extension once (`src/foo.ts` → `src/foo`).
//   3. Walk from the selected path up to the root, building per-level
//      candidates `[fullPath, basename]`. At EACH level probe BOTH key shapes:
//        - file-form:   `${key}.html`, `${key}.txt`
//        - README-form: `${key}/README.html|txt|md` (reuse readmeKeyCandidates)
//      so a folder path resolves its README and a file path resolves its
//      `.html`, and a file whose own doc is absent falls back to its
//      containing folder's README.
//   4. On a miss, walk to the parent (`substring(0, lastIndexOf('/'))`), then
//      try root (''), then stop.
//
// `inherited` tracks WALK DEPTH from the selected path, not key shape:
//   - false (exact): the hit is at the selected path's OWN key — including a
//     folder whose own README matched (README is one segment 'down' in key
//     shape, but it is the selected folder's own doc, so depth 0 → exact).
//   - true (ancestor): the hit came from walking UP to a shallower path. A
//     FILE selection whose own doc is absent but whose containing folder's
//     README matches counts as inherited (it is not the file's own doc).
// ---------------------------------------------------------------------------

/**
 * First-hit, parent-walking lookup of the closest design doc for a selected
 * path. Returns the matched bundle `key`, the `doc`, and an `inherited` flag
 * (false = the selected path's own doc, true = inherited from an ancestor).
 * Returns `null` when nothing matches up to the root.
 *
 * Bundle-only — no `window`, `document`, or `fetch` (VS-B2 removed the fetch
 * fallback), so this is importable from the unit tests.
 */
export function resolveClosestDoc(
    docs: Record<string, DesignDoc>,
    path: string,
    type: 'file' | 'directory',
): { key: string; doc: DesignDoc; inherited: boolean } | null {
    let currentPath: string | null = path.replace(/\\/g, '/');
    if (type === 'file') {
        const lastDot = currentPath.lastIndexOf('.');
        if (lastDot > 0) currentPath = currentPath.substring(0, lastDot);
    }

    // The selected path's own (extension-stripped) key — used to distinguish
    // an exact hit (depth 0) from an inherited ancestor hit.
    const ownKey = currentPath;
    let isFirstLevel = true;

    while (currentPath !== null) {
        const candidates: string[] = [currentPath];
        const baseName = currentPath.split('/').pop();
        if (baseName && baseName !== currentPath) candidates.push(baseName);

        // Probe file-form keys first, then README-form keys, at this level.
        const fileFormKeys: string[] = [];
        const readmeFormKeys: string[] = [];
        for (const key of candidates) {
            fileFormKeys.push(`${key}.html`, `${key}.txt`);
            for (const rk of readmeKeyCandidates(key)) readmeFormKeys.push(rk);
        }

        for (const bundleKey of [...fileFormKeys, ...readmeFormKeys]) {
            const doc = docs[bundleKey];
            if (doc !== undefined) {
                // Exact only when we are still at the selected path's own
                // level AND the hit's path segment is the selected path
                // (file-form `${ownKey}.*`) or the selected folder's own
                // README (`${ownKey}/README.*`). Any shallower level, or a
                // basename fallback, is inherited.
                const exact =
                    isFirstLevel &&
                    (bundleKey === `${ownKey}.html` ||
                        bundleKey === `${ownKey}.txt` ||
                        bundleKey === `${ownKey}/README.html` ||
                        bundleKey === `${ownKey}/README.txt` ||
                        bundleKey === `${ownKey}/README.md`);
                return { key: bundleKey, doc, inherited: !exact };
            }
        }

        if (currentPath === '') break;

        const lastSlash = currentPath.lastIndexOf('/');
        currentPath = lastSlash === -1 ? '' : currentPath.substring(0, lastSlash);
        isFirstLevel = false;
    }

    return null;
}
