/**
 * Hub / instability analyzer (Ca, Ce, I).
 *
 * Computes, per import-graph FILE node, its afferent coupling `Ca` (fan-in),
 * efferent coupling `Ce` (fan-out), and Martin instability
 * `I = Ce / (Ca + Ce)`, flags **outliers** (degree `Ca + Ce >= HUB_DEGREE_THRESHOLD`)
 * and labels each `kernel` (low instability — a healthy shared dependency) or
 * `unstable-hub` (high instability — the risky case).
 *
 * Mirrors the `cycles.ts` shape: a pure inner `hubMetricsFromGraph(importGraph)`
 * (no IO — directly unit-testable) plus a thin ctx-loading wrapper that builds
 * the graph from the edge-list stores once and derives both the findings and the
 * global max fan-in.
 *
 * Counting rule (D1/D2/D3): Ca/Ce count ONLY edges whose BOTH endpoints are
 * `kind === 'file'` nodes present in `importGraph.nodes`. Edges to/from
 * `external` (npm/lib) nodes are EXCLUDED from counting and scoring. Distinct
 * endpoints are deduped via a `Set` (parallel edges count once).
 *
 * Determinism: findings are sorted by `degree` descending, ties broken by `id`
 * ascending. No timestamps / `Date` / `Math.random`.
 */

import type { WorkspaceContext } from '../workspace-context';
import { loadGraphs } from './load-graphs';
import type { ImportGraph } from '../../graph/types';
import type { HubFinding, HubLabel } from './types';

/**
 * Outlier degree gate (D5). A file node is a hub outlier iff
 * `Ca + Ce >= HUB_DEGREE_THRESHOLD`. Fixed (not a percentile) so the unit test
 * is deterministic and the report stays diff-stable as the repo grows.
 */
export const HUB_DEGREE_THRESHOLD = 8;

/**
 * Kernel/unstable label boundary (D6). An outlier with `I <= KERNEL_INSTABILITY_MAX`
 * is a `kernel` (low instability, high incoming dependence — healthy shared
 * dependency); otherwise `unstable-hub`.
 */
export const KERNEL_INSTABILITY_MAX = 0.3;

/**
 * Pure: derive hub `HubFinding`s from an already-built `ImportGraph`.
 *
 * Recall-first: ALL outliers (degree >= threshold) are flagged, kernels included;
 * the `label` carries the nuance and kernels are never dropped.
 */
export function hubMetricsFromGraph(importGraph: ImportGraph): HubFinding[] {
    // Distinct incoming (Ca) / outgoing (Ce) file-node endpoints per node id.
    const caSets = new Map<string, Set<string>>();
    const ceSets = new Map<string, Set<string>>();

    const isFileNode = (id: string): boolean =>
        importGraph.nodes.get(id)?.kind === 'file';

    for (const e of importGraph.edges) {
        // D1/D3: count only file→file edges between nodes present in the graph.
        if (!isFileNode(e.source) || !isFileNode(e.target)) {
            continue;
        }
        // D2: dedupe by distinct opposite endpoint.
        let ce = ceSets.get(e.source);
        if (!ce) {
            ce = new Set<string>();
            ceSets.set(e.source, ce);
        }
        ce.add(e.target);

        let ca = caSets.get(e.target);
        if (!ca) {
            ca = new Set<string>();
            caSets.set(e.target, ca);
        }
        ca.add(e.source);
    }

    const findings: Array<HubFinding & { degree: number }> = [];

    for (const [id, node] of importGraph.nodes) {
        if (node.kind !== 'file') {
            continue; // D3: only score file nodes (external never scored).
        }
        const ca = caSets.get(id)?.size ?? 0;
        const ce = ceSets.get(id)?.size ?? 0;
        const degree = ca + ce;
        if (degree < HUB_DEGREE_THRESHOLD) {
            continue; // D5: not an outlier.
        }
        const instability = degree === 0 ? 0 : ce / degree; // D4 guard.
        const label: HubLabel =
            instability <= KERNEL_INSTABILITY_MAX ? 'kernel' : 'unstable-hub'; // D6.

        findings.push({
            id: 'hub:' + id,
            type: 'hub',
            // severity is informational — hubs RANK below cycles, they are not a
            // gate; the kernel|unstable-hub label carries the real signal.
            severity: 'medium',
            title: `${ca} in / ${ce} out (I=${instability.toFixed(2)}) — ${label}`,
            detail:
                `${id}: Ca=${ca} (fan-in), Ce=${ce} (fan-out), ` +
                `I=${instability.toFixed(2)} — ${
                    label === 'kernel'
                        ? 'low instability, a healthy shared dependency'
                        : 'high instability, a risky hub (depends on many AND is depended upon)'
                }`,
            relatedFiles: [id],
            ca,
            ce,
            instability,
            label,
            degree,
        });
    }

    // D7: degree descending, ties broken by id ascending (deterministic).
    findings.sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));

    // Strip the internal `degree` helper field from the public DTO.
    return findings.map(({ degree, ...f }) => {
        void degree;
        return f;
    });
}

/**
 * Pure: global maximum afferent coupling (Ca) over ALL file nodes — NOT just
 * flagged outliers. This is the scorecard's `maxFanIn`. A high-Ca node below the
 * degree threshold (rare, since high Ca drives degree up) still counts here.
 */
export function maxFanInFromGraph(importGraph: ImportGraph): number {
    const caSets = new Map<string, Set<string>>();
    const isFileNode = (id: string): boolean =>
        importGraph.nodes.get(id)?.kind === 'file';

    for (const e of importGraph.edges) {
        if (!isFileNode(e.source) || !isFileNode(e.target)) {
            continue;
        }
        let ca = caSets.get(e.target);
        if (!ca) {
            ca = new Set<string>();
            caSets.set(e.target, ca);
        }
        ca.add(e.source);
    }

    let max = 0;
    for (const [id, node] of importGraph.nodes) {
        if (node.kind !== 'file') {
            continue;
        }
        const ca = caSets.get(id)?.size ?? 0;
        if (ca > max) {
            max = ca;
        }
    }
    return max;
}

/**
 * ctx-in / data-out: load the import + call edge-list stores, build the import
 * graph via `buildGraphsFromSplitEdgeLists`, and delegate to
 * `hubMetricsFromGraph`.
 */
export async function computeHubMetrics(
    ctx: WorkspaceContext,
): Promise<HubFinding[]> {
    return hubMetricsFromGraph((await loadGraphs(ctx)).importGraph);
}

/**
 * ctx-in / data-out: build the import graph ONCE and return both the hub
 * findings and the global max fan-in (so `health.ts` avoids a double store
 * load). `maxFanIn` is the global max Ca over ALL file nodes, not `max(hubs.ca)`.
 */
export async function computeHubReport(
    ctx: WorkspaceContext,
): Promise<{ hubs: HubFinding[]; maxFanIn: number }> {
    const { importGraph } = await loadGraphs(ctx);
    return {
        hubs: hubMetricsFromGraph(importGraph),
        maxFanIn: maxFanInFromGraph(importGraph),
    };
}
