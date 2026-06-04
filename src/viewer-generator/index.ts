/**
 * Viewer / static-graph generator — barrel (Loop 15 split).
 *
 * Generates static HTML graph and provides URLs for browser viewing.
 * This is a helper module that wraps the existing webview generation
 * with workspace path handling.
 *
 * The former ~501-line monolith was carved into this directory; this file
 * is now a THIN barrel (the directory's `index.ts`) that re-exports every
 * previously-public symbol so all existing import sites
 * (`from '../viewer-generator'`, `from '../../viewer-generator'`) keep
 * working UNCHANGED.
 *
 * Layout of the carved units:
 *   - `./asset-root-resolver.ts`       — package-root / asset
 *                                        discovery (`findRepoRoot`,
 *                                        `findInstalledPackageRoot`,
 *                                        `__testHooks`,
 *                                        `resolveAssetRoot`).
 *   - `./viewer-generation-usecase.ts` — `generateGraph` flow +
 *                                        its option/result types.
 *   - `./graph-stats.ts`               — `hasEdgeLists` +
 *                                        `getGraphStats`.
 *   - `./open-browser.ts`              — `openInBrowser` (distinct
 *                                        from the server's
 *                                        `open-browser.ts`).
 */

// Asset-root discovery + the test seam.
export {
    findRepoRoot,
    findInstalledPackageRoot,
    __testHooks,
    resolveAssetRoot,
} from './asset-root-resolver';

// Static-graph generation use-case + its public shapes.
export type {
    GraphGenerationOptions,
    GraphGenerationResult,
} from './viewer-generation-usecase';
export { generateGraph } from './viewer-generation-usecase';

// Edge-list presence + statistics queries.
export { hasEdgeLists, getGraphStats } from './graph-stats';

// Browser-open helper.
export { openInBrowser } from './open-browser';
