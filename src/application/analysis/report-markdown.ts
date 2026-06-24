/**
 * Deterministic markdown renderer for a `HealthReport`.
 *
 * Emits a fixed-order, fixed-wording document: a scorecard reading every
 * measurement-vector dimension, followed by `## 1. Import cycles`. Same
 * `HealthReport` in → byte-identical string out.
 *
 * Determinism rules: arrays are iterated in their given (already-sorted) order;
 * this module NEVER calls `Date`/`Date.now`/`new Date()`/`Math.random` and never
 * iterates an unsorted map. No trailing generation note / timestamp.
 */

import type { HealthReport } from './types';

/** Render a `HealthReport` as deterministic, timestamp-free markdown. */
export function renderHealthReport(report: HealthReport): string {
    const v = report.vector;
    const lines: string[] = [];

    lines.push(`# LLMem Health Report — ${report.repo}`);
    lines.push('');
    lines.push('## Scorecard (measurement vector)');
    lines.push(
        `import cycles: ${v.importCyclesRuntime} (runtime) / ${v.importCyclesInclTypeOnly} (incl. type-only edges)`,
    );
    lines.push(
        `call cycles: ${v.callCyclesMutual} (mutual) / ${v.callCyclesRecursion} (recursion)`,
    );
    lines.push(
        `clone clusters: ${v.cloneClustersHigh} (high) / ${v.cloneClustersTotal} (total)`,
    );
    lines.push(`hub outliers: ${v.hubOutliers} (max fan-in ${v.maxFanIn})`);
    lines.push(`files over budget: ${v.filesOverBudget}`);

    lines.push('');
    lines.push('## 1. Import cycles');
    const cycles = report.importCycles;
    if (cycles.length === 0) {
        lines.push('No import cycles found.');
    } else {
        lines.push(`Found ${cycles.length} import cycle(s):`);
        cycles.forEach((f, i) => {
            lines.push('');
            lines.push(
                `Cycle ${i + 1}: ${f.members.length}-file cycle — ` +
                    `${f.typeOnlyEdgeCount ?? 0} of ${f.totalEdgeCount ?? 0} ` +
                    `edges are type-only (erased at compile time); ` +
                    `runtime cycle is ${f.runtimeMembers?.length ?? f.members.length} files`,
            );
            lines.push(`  ${f.shortestPath.join(' -> ')}`);
        });
    }

    return lines.join('\n');
}
