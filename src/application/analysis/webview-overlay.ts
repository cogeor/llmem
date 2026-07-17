/**
 * Health-overlay assembly (Loop 08 / health-highlight).
 *
 * ONE application-layer helper that assembles the browser-safe, node-free
 * `HealthOverlay` DTO (defined in `src/contracts/webview-payloads.ts`) from the
 * PERSISTED analysis artifacts + cheap analyzers, and hands it to the graph
 * layer via `prepareWebviewDataFromSplitEdgeLists`. This is the SINGLE place
 * the legitimate application→graph-clone-store + application→analysis imports
 * live — the graph and webview layers consume the overlay as plain data and
 * never import the application layer (keeps `tests/arch/layer-matrix.test.ts`
 * green).
 *
 * SOURCE discipline (CORRECTION over the plan's "read health-report.json"):
 *   - Clone edges come from the persisted `clone-edgelist.json` via the
 *     graph-layer `CloneEdgeListStore` (analysis→graph is in-layer). Each
 *     `CloneEdge` (entity-id `source`/`target`) becomes a `cloneEdges` entry.
 *   - Node smells are derived from CHEAP arithmetic only — `computeHubReport`
 *     (pure edge-list math, NO parse / NO ts.Program rebuild) for hub smells,
 *     plus clone-membership smells from the loaded clone edges.
 *   - We DO NOT call the full `runHealthScan` (it would rebuild the clone
 *     ts.Program on every webview regen) and we DO NOT require
 *     `health-report.json` to exist.
 *
 * Tolerance: a missing clone-edgelist or an empty hub report yields an empty
 * overlay — this helper NEVER throws (mirrors the `viewer-data` posture).
 */

import type { WorkspaceContext } from '../workspace-context';
import type { HealthOverlay, SmellMarker } from '../../contracts/webview-payloads';
import { CloneEdgeListStore, type CloneEdge } from '../../graph/edgelist';
import { computeHubReport } from './metrics';

/**
 * Assemble the plain `HealthOverlay` from persisted artifacts + cheap
 * analyzers. Tolerant: any sub-step failure degrades to an empty overlay.
 */
export async function buildHealthOverlay(
    ctx: WorkspaceContext,
): Promise<HealthOverlay> {
    const cloneEdges = await loadCloneEdges(ctx);
    const nodeSmells: Record<string, SmellMarker[]> = {};

    // (a) Hub smells — cheap arithmetic over the import edge list (no parse).
    try {
        const { hubs } = await computeHubReport(ctx);
        for (const hub of hubs) {
            // HubFinding.relatedFiles is the single import-graph file node id.
            for (const fileId of hub.relatedFiles) {
                addSmell(nodeSmells, fileId, {
                    kind: hub.type, // 'hub'
                    severity: hub.severity,
                    title: hub.title,
                });
            }
        }
    } catch (e) {
        ctx.logger.error(
            `[webview-overlay] hub report failed — skipping hub smells: ${
                e instanceof Error ? e.message : String(e)
            }`,
        );
    }

    // (b) Clone-membership smells — every entity that participates in a clone
    // pair gets a 'clone' smell badge on its call-graph node.
    for (const c of cloneEdges) {
        const title = `clone (${c.cloneType}${c.sharedKind ? `: ${c.sharedKind}` : ''})`;
        addSmell(nodeSmells, c.source, { kind: 'clone', severity: c.severity, title });
        addSmell(nodeSmells, c.target, { kind: 'clone', severity: c.severity, title });
    }

    return {
        cloneEdges: cloneEdges.map((c) => ({
            source: c.source,
            target: c.target,
            severity: c.severity,
        })),
        nodeSmells,
    };
}

/**
 * Tolerant load of the persisted clone edge list. The store itself degrades a
 * missing/invalid file to empty; the extra try/catch guards an unexpected I/O
 * failure so the overlay assembly never throws.
 */
async function loadCloneEdges(ctx: WorkspaceContext): Promise<CloneEdge[]> {
    try {
        const store = new CloneEdgeListStore(ctx.artifactRoot, ctx.artifactIo, undefined);
        await store.load();
        return store.getEdges();
    } catch (e) {
        ctx.logger.error(
            `[webview-overlay] clone-edgelist load failed — empty clone overlay: ${
                e instanceof Error ? e.message : String(e)
            }`,
        );
        return [];
    }
}

/** Append a smell to a node id's list, creating the list on first use. */
function addSmell(
    map: Record<string, SmellMarker[]>,
    id: string,
    smell: SmellMarker,
): void {
    const list = map[id] ?? (map[id] = []);
    list.push(smell);
}
