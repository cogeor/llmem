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

    lines.push('');
    lines.push('## 2. Call cycles');
    const callCycles = report.callCycles;
    if (callCycles.length === 0) {
        lines.push('No mutual call cycles found.');
    } else {
        lines.push(`Found ${callCycles.length} mutual call cycle(s):`);
        callCycles.forEach((f, i) => {
            lines.push('');
            lines.push(
                `Cycle ${i + 1} (${f.members.length} entities): ${f.members.join(', ')}`,
            );
            lines.push(`  ${f.shortestPath.join(' -> ')}`);
        });
    }

    const recursion = report.recursion ?? [];
    lines.push('');
    lines.push('### Direct self-recursion');
    if (recursion.length === 0) {
        lines.push('No direct self-recursion found.');
    } else {
        lines.push(`Found ${recursion.length} self-recursive entit(ies):`);
        recursion.forEach(f => lines.push(`  ${f.title}`));
    }

    // §3 Duplication is Loop 06; emit the spec's fixed section number `## 4`
    // here even with the §3 gap. Order-preserving: the array is already sorted
    // by metrics.ts (degree desc, id asc) — do NOT re-sort.
    lines.push('');
    lines.push('## 4. Hubs & instability');
    const hubs = report.hubs;
    if (hubs.length === 0) {
        lines.push('No hub outliers found.');
    } else {
        lines.push('| File | Ca (in) | Ce (out) | I | Label |');
        lines.push('| --- | --- | --- | --- | --- |');
        hubs.forEach(h => {
            lines.push(
                `| ${h.relatedFiles[0]} | ${h.ca} | ${h.ce} | ${h.instability.toFixed(2)} | ${h.label} |`,
            );
        });
    }

    return lines.join('\n');
}
