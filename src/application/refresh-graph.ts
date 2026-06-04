/**
 * On-demand graph refresh (LS-06) — THIN BARREL.
 *
 * The implementation lives in the sibling `refresh-graph/` directory, split by
 * responsibility so each unit stays under the src/application 350-line budget:
 *   - `refresh-graph/shared.ts` — `emptyCoverage` + the `walkFsStats` stat-walk
 *     util shared by both paths (imports neither, so no cycle).
 *   - `refresh-graph/folder.ts` — `refreshFolderGraph` (the folder path).
 *   - `refresh-graph/file.ts`   — `refreshFileGraph` (the single-file path).
 *
 * Importers continue to `import { ... } from '../application/refresh-graph'`
 * (document-file / document-folder, the server regenerator, etc.) unchanged.
 */

export {
    refreshFolderGraph,
    type RefreshFolderGraphOptions,
} from './refresh-graph/folder';
export {
    refreshFileGraph,
    type RefreshFileGraphOptions,
} from './refresh-graph/file';
