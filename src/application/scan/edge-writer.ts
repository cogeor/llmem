/**
 * Edge-list write helpers, factored from the duplicated
 * `artifactToEdgeList(...) + addNodes/addEdges` block in `scanFile` and
 * `scanFolder` (loop 07). Also holds the shared `loadOrClearOnMismatch`
 * self-heal used by both scan use-cases.
 */

import { CallEdgeListStore, ImportEdgeListStore, SchemaMismatchError } from '../../graph/edgelist';
import type { ConversionResult } from '../artifact-converter';
import type { Logger } from '../../core/logger';

/**
 * Apply an already-converted artifact (nodes + call/import edges) to both
 * stores: add nodes to each store, then add every call edge to the call store
 * and every import edge to the import store. Returns the raw per-call edge
 * counts (the parser's reported counts, NOT the store's net-new delta) so the
 * caller can keep its legacy `newCallEdgeCount` / `newImportEdgeCount` parity
 * tallies.
 *
 * Does NOT save — the caller batches `save()` after the whole walk.
 */
export function applyArtifactToStores(
    conversion: ConversionResult,
    callStore: CallEdgeListStore,
    importStore: ImportEdgeListStore,
): { callEdges: number; importEdges: number } {
    const { nodes, callEdges, importEdges } = conversion;

    // Add nodes to both stores.
    callStore.addNodes(nodes);
    importStore.addNodes(nodes);

    // Add call edges.
    for (const edge of callEdges) {
        callStore.addEdge(edge);
    }

    // Add import edges.
    for (const edge of importEdges) {
        importStore.addEdge(edge);
    }

    return { callEdges: callEdges.length, importEdges: importEdges.length };
}

/**
 * Load both stores; on `SchemaMismatchError` from either, log a warn,
 * clear both stores in place, and continue. The in-progress scan then
 * proceeds against an empty store and `save()` writes a v_next envelope.
 *
 * Used by `scanFile` and `scanFolder` so the CLI/scan path self-heals
 * stale envelopes mid-scan without recursing into a fresh
 * `scanFolderRecursive` (the caller is already inside a scan flow).
 */
export async function loadOrClearOnMismatch(
    callStore: CallEdgeListStore,
    importStore: ImportEdgeListStore,
    logger: Logger,
): Promise<void> {
    let mismatch = false;
    try {
        await callStore.load();
    } catch (e) {
        if (e instanceof SchemaMismatchError) {
            mismatch = true;
        } else {
            throw e;
        }
    }
    try {
        await importStore.load();
    } catch (e) {
        if (e instanceof SchemaMismatchError) {
            mismatch = true;
        } else {
            throw e;
        }
    }
    if (mismatch) {
        logger.warn('[GenerateEdges] Edge-list schema mismatch — rescanning into a fresh envelope');
        callStore.clear();
        importStore.clear();
    }
}
