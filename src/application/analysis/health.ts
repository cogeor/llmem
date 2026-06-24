/**
 * Health-scan composer.
 *
 * Composes the analysis dimensions into a single `HealthReport`. This loop only
 * wires `findImportCycles`; call-cycles / hubs / clones are stubbed `[]` with
 * TODOs referencing the loops that fill them in. The measurement vector's
 * import-cycle dims are populated; everything else is zeroed.
 *
 * Determinism: no timestamps. `repo` is a stable basename label derived from
 * `ctx.workspaceRoot`.
 */

import type { WorkspaceContext } from '../workspace-context';
import type { HealthReport, HealthVector } from './types';
import { zeroHealthVector } from './types';
import { findImportCycles } from './cycles';

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

    // TODO(Loop 04): findCallCycles. TODO(Loop 05): computeHubMetrics.
    // TODO(Loop 06): findClones.
    const callCycles: HealthReport['callCycles'] = [];
    const clones: HealthReport['clones'] = [];
    const hubs: HealthReport['hubs'] = [];

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

    // Basename label only (no timestamp). Split on both separators so it works
    // regardless of the OS-native form of `workspaceRoot`.
    const repo =
        ctx.workspaceRoot.split(/[\\/]/).pop() ?? ctx.workspaceRoot;

    return { repo, vector, importCycles, callCycles, clones, hubs };
}
