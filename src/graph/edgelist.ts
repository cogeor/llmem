/**
 * Edge List Storage — barrel (Loop 14 split).
 *
 * The former ~577-line monolith was carved into the `edge-list/` sibling
 * directory (note: distinct name from this `edgelist.ts` FILE to avoid a
 * case/name collision on Windows). This file is now a THIN barrel that
 * re-exports every previously-public symbol so all existing import sites
 * (`from '../graph/edgelist'`, `from './edgelist'`) keep working UNCHANGED.
 *
 * Layout of the carved units:
 *   - `edge-list/atomic-write.ts` — `writeFileAtomic` (temp-write + rename
 *                                   publish) + the temp-suffix counter.
 *   - `edge-list/lock.ts`         — `withWriteLock` in-process write mutex.
 *   - `edge-list/mutations.ts`    — pure node/edge mutation primitives.
 *   - `edge-list/base-store.ts`   — `BaseEdgeListStore` (persistence + the
 *                                   mutation-delegating methods).
 *   - `edge-list/stores.ts`       — `ImportEdgeListStore` + `CallEdgeListStore`.
 *
 * The schema module (`./edgelist-schema`) remains the single source of truth
 * for the data types and the `EdgeListLoadError` / `SchemaMismatchError`
 * classes; this barrel re-exports them so callsites importing from
 * `../graph/edgelist` keep one resolution path.
 *
 * Module-resolution note: a sibling `edgelist.ts` FILE takes precedence over
 * any `edgelist/` DIRECTORY for `import ... from './edgelist'`, so this barrel
 * stays the single authoritative entry point.
 */

// Public types + error classes — re-export from the schema source of truth.
export type { EdgeListData, NodeEntry, EdgeEntry } from './edgelist-schema';
export { EdgeListLoadError, SchemaMismatchError } from './edgelist-schema';

// Atomic publish helper (reused by the scan manifest writer).
export { writeFileAtomic } from './edge-list/atomic-write';

// In-process save serialization mutex.
export { withWriteLock } from './edge-list/lock';

// Concrete edge stores.
export { ImportEdgeListStore, CallEdgeListStore } from './edge-list/stores';

// Standalone clone store (Loop 06) — own schema/version, separate JSON file.
export {
    CloneEdgeListStore,
    CLONE_EDGELIST_SCHEMA_VERSION,
    type CloneEdge,
    type CloneType,
    type CloneEdgeListData,
} from './edge-list/clone-store';
