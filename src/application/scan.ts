/**
 * Scan workflow barrel (loop 07).
 *
 * The former monolithic ~742-line `application/scan.ts` was carved into a
 * `scan/` directory of reusable units so `scanFile`/`scanFolder` consume them
 * AND the on-demand refresh path (loop 08) can reuse the SAME candidate
 * classifier + parser-runner + edge-writer. This file is now a THIN barrel
 * that re-exports every previously-public symbol so all existing import sites
 * (`from '../application/scan'`, `from './scan'`) keep working UNCHANGED.
 *
 * Layout of the carved units:
 *   - `scan/types.ts`         — ScanError, ScanCoverage, ScanResult, request types.
 *   - `scan/coverage.ts`      — emptyCoverage / mergeCoverage (reusable).
 *   - `scan/hints.ts`         — SOURCE_LIKE_INSTALL_HINTS + formatUnsupportedSourceHints.
 *   - `scan/candidate.ts`     — the single per-file gate classifier.
 *   - `scan/parser-runner.ts` — shared getParser try/catch + extract.
 *   - `scan/edge-writer.ts`   — applyArtifactToStores + loadOrClearOnMismatch.
 *   - `scan/use-cases.ts`     — scanFile / scanFolder / scanFolderRecursive /
 *                               rescanAfterSchemaMismatch.
 *
 * Module-resolution note: a sibling `scan.ts` FILE takes precedence over the
 * `scan/` DIRECTORY for `import ... from './scan'`, so this barrel stays the
 * single authoritative entry point.
 */

// Public types — re-export verbatim from the types unit.
export type {
    ScanError,
    ScanCoverage,
    ScanResult,
    ScanFileRequest,
    ScanFolderRequest,
} from './scan/types';

// Unsupported-source-like hint formatter.
export { formatUnsupportedSourceHints } from './scan/hints';

// Scan use-cases.
export {
    scanFile,
    scanFolder,
    scanFolderRecursive,
    rescanAfterSchemaMismatch,
} from './scan/use-cases';
