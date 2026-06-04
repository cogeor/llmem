/**
 * Folder view-model — barrel (Loop 15 split).
 *
 * Pure, DOM-free derivations for PackageView. The former ~386-line module
 * was carved into the `folder-view-model/` sibling directory; this file is
 * now a THIN barrel that re-exports every previously-public symbol so all
 * existing import sites (`from './folderViewModel'`, and the unit test's
 * `from '.../components/folderViewModel'`) keep working UNCHANGED.
 *
 * CRITICAL: every carved unit is browser-pure — function/interface exports
 * only, no `window.*`, `document.*`, `fetch`, `node:*`, or `vscode` imports.
 * The browser-purity arch test (`tests/arch/browser-purity.test.ts`) covers
 * `src/webview/ui` transitively, so the new files stay clean.
 *
 * Layout of the carved units:
 *   - `folder-view-model/package-view-model.ts` — vis-network type surface +
 *                                                 `buildVisNodes` /
 *                                                 `buildVisEdges`.
 *   - `folder-view-model/folder-metrics.ts`     — `folderOf`.
 *   - `folder-view-model/edge-formatting.ts`    — `parseEdgeId` /
 *                                                 `findFolderEdgeById` /
 *                                                 `nonIncidentEdgeIds`.
 *   - `folder-view-model/doc-resolution.ts`     — `readmeKeyCandidates` /
 *                                                 `resolveReadmeDoc` /
 *                                                 `resolveClosestDoc`.
 *
 * Module-resolution note: a sibling `folderViewModel.ts` FILE takes
 * precedence over the (distinctly-named) `folder-view-model/` DIRECTORY for
 * `import ... from './folderViewModel'`, so this barrel stays the single
 * authoritative entry point.
 */

// vis-network type surface + tree→vis transforms.
export type {
    VisNetworkNode,
    VisNetworkEdge,
    VisNetworkOptions,
    VisNetworkInstance,
    VisEventParams,
    BuildVisEdgesOptions,
} from './folder-view-model/package-view-model';
export { buildVisNodes, buildVisEdges } from './folder-view-model/package-view-model';

// Folder-path derivation.
export { folderOf } from './folder-view-model/folder-metrics';

// Edge-id decode + incidence helpers.
export type { ParsedEdgeId } from './folder-view-model/edge-formatting';
export {
    parseEdgeId,
    findFolderEdgeById,
    nonIncidentEdgeIds,
} from './folder-view-model/edge-formatting';

// Design-doc lookups.
export {
    readmeKeyCandidates,
    resolveReadmeDoc,
    resolveClosestDoc,
} from './folder-view-model/doc-resolution';
