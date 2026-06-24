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
import { readManifest } from '../scan-manifest';

/**
 * `filesOverBudget` threshold (lines). A single, documented recall-first
 * approximation of the per-layer arch budgets (200 core/contracts, 250 cli,
 * 350 application/graph/webview-ui, 400). 350 is the dominant + median budget;
 * one number under-counts files in the 200/250 layers and won't count a file at
 * exactly its 350 budget — but the measurement vector only needs a stable,
 * monotone file-size signal for before/after diffs, NOT the per-layer arch
 * verdict. `tests/arch/file-size-budget.test.ts` remains the authoritative
 * per-layer gate.
 */
const FILE_SIZE_BUDGET_LINES = 350;

/** Options for `runHealthScan`. Reserved for Loop 02+ (refresh toggle, severity floor). */
export interface HealthScanOptions {
    // intentionally empty this loop
}

/**
 * Run the health scan over `ctx` and compose a `HealthReport`.
 *
 * Every `HealthVector` dimension is populated by its analyzer; `filesOverBudget`
 * is read from the scan-manifest line counts (no parsing). The returned report
 * carries NO timestamp, so `JSON.stringify(report)` is byte-stable across two
 * runs on an unchanged repo (measurement-loop determinism).
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

    // Loop 09: filesOverBudget — count files whose recorded `lines` exceed the
    // single documented threshold (FILE_SIZE_BUDGET_LINES = 350). Source of
    // truth is the scan-manifest `lines` field (no parsing here). A
    // missing/corrupt manifest yields `readManifest -> {files:{}}`, so a
    // workspace with no manifest deterministically reports 0 over-budget files.
    const manifest = await readManifest(ctx);
    vector.filesOverBudget = Object.values(manifest.files)
        .filter(e => e.lines > FILE_SIZE_BUDGET_LINES).length;

    // Basename label only (no timestamp). Split on both separators so it works
    // regardless of the OS-native form of `workspaceRoot`.
    const repo =
        ctx.workspaceRoot.split(/[\\/]/).pop() ?? ctx.workspaceRoot;

    return { repo, vector, importCycles, callCycles, recursion, clones, hubs };
}

/**
 * Pure predicate: true iff `report` carries >= 1 finding of `kind` (the
 * `--fail-on` contract). Deterministic — a read of the report, no Date/random.
 *
 * Kind -> source mapping:
 *   - `import-cycle` -> `report.vector.importCyclesRuntime > 0` (RUNTIME count,
 *     NOT the full-graph SCC array; a cycle held together solely by `import
 *     type` edges is erased at compile time and does NOT trip the gate).
 *   - `call-cycle`   -> `report.callCycles.length > 0`
 *   - `clone`        -> `report.clones.length > 0`
 *   - `hub`          -> `report.hubs.length > 0`
 *   - `recursion`    -> `(report.recursion ?? []).length > 0` (recursion
 *     findings live in `report.recursion`, NOT `report.callCycles`).
 *   - any other kind -> `false` (an unknown/typo kind never fails the build).
 */
export function reportHasFindingKind(report: HealthReport, kind: string): boolean {
    switch (kind) {
        case 'import-cycle': return report.vector.importCyclesRuntime > 0;
        case 'call-cycle':   return report.callCycles.length > 0;
        case 'clone':        return report.clones.length > 0;
        case 'hub':          return report.hubs.length > 0;
        case 'recursion':    return (report.recursion ?? []).length > 0;
        default: return false; // unknown kind -> never fails the build
    }
}
