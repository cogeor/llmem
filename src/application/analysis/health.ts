/**
 * Health-scan composer.
 *
 * Composes the analysis dimensions into a single `HealthReport`: import cycles
 * (L03), call cycles + recursion (L04), hubs (L05) and clones (L06). The
 * measurement vector is populated from each dimension's findings.
 *
 * Determinism: no timestamps. `repo` is a stable basename label derived from
 * `ctx.workspaceRoot`.
 */

import type { WorkspaceContext } from '../workspace-context';
import type { HealthReport, HealthVector } from './types';
import { zeroHealthVector } from './types';
import { findImportCycles, findCallCycles } from './cycles';
import { findClones } from './clones';
import { computeHubReport } from './metrics';

/** Options for `runHealthScan`. Reserved for Loop 02+ (refresh toggle, severity floor). */
export interface HealthScanOptions {
    // intentionally empty this loop
}

/**
 * Run the health scan over `ctx` and compose a `HealthReport`.
 *
 * This loop wires only the import-cycle analyzer; the remaining dimensions are
 * stubbed.
 */
export async function runHealthScan(
    ctx: WorkspaceContext,
    opts?: HealthScanOptions,
): Promise<HealthReport> {
    void opts; // reserved for Loop 02+ (no options consumed yet)
    const importCycles = await findImportCycles(ctx);
    const { cycles: callCycles, recursion } = await findCallCycles(ctx);

    const clones = await findClones(ctx);
    const { hubs, maxFanIn } = await computeHubReport(ctx);

    const vector: HealthVector = zeroHealthVector();
    // incl-type-only: ALL cycles over the full graph (the analyzer runs the SCC
    // engine over every edge). runtime: only cycles whose runtime core still has
    // >= 2 members after type-only edges are stripped — a cycle held together
    // solely by `import type` edges collapses (runtimeMembers.length < 2) and is
    // NOT a runtime cycle. (Self-loops don't occur for file imports; the >= 2
    // test is correct here. Call-cycle recursion is Loop 04.)
    vector.importCyclesInclTypeOnly = importCycles.length;
    vector.importCyclesRuntime = importCycles.filter(
        c => (c.runtimeMembers?.length ?? c.members.length) >= 2,
    ).length;

    // Loop 04: mutual-recursion call cycles vs the direct self-recursion bucket.
    vector.callCyclesMutual = callCycles.length;
    vector.callCyclesRecursion = recursion.length;

    // Loop 05: hub / instability. `maxFanIn` is the global max Ca over ALL file
    // nodes (not just flagged outliers); `hubOutliers` is the count of flagged.
    vector.maxFanIn = maxFanIn;
    vector.hubOutliers = hubs.length;

    // Loop 06: exact-body clone clusters. `cloneClustersHigh` counts the
    // cross-layer (high-severity) clusters; total counts every cluster.
    vector.cloneClustersTotal = clones.length;
    vector.cloneClustersHigh = clones.filter(c => c.severity === 'high').length;

    // Basename label only (no timestamp). Split on both separators so it works
    // regardless of the OS-native form of `workspaceRoot`.
    const repo =
        ctx.workspaceRoot.split(/[\\/]/).pop() ?? ctx.workspaceRoot;

    return { repo, vector, importCycles, callCycles, recursion, clones, hubs };
}
