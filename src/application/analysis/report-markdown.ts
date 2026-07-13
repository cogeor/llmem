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
    lines.push(
        `interface width: max W_eff ${v.maxEffectiveWidth.toFixed(2)}, ${v.interfaceWidthShallowWide} shallow-wide module(s)`,
    );
    lines.push(`files over budget: ${v.filesOverBudget}`);

    lines.push('');
    lines.push('## 1. Import cycles');
    const cycles = report.importCycles;
    if (cycles.length === 0) {
        lines.push('No import cycles found.');
    } else {
        lines.push(`Found ${cycles.length} import cycle(s):`);
        const MEMBER_CAP = 20;
        cycles.forEach((f, i) => {
            lines.push('');
            lines.push(
                `Cycle ${i + 1}: ${f.members.length}-file cycle — ` +
                    `${f.typeOnlyEdgeCount ?? 0} of ${f.totalEdgeCount ?? 0} ` +
                    `edges are type-only (erased at compile time); ` +
                    `runtime cycle is ${f.runtimeMembers?.length ?? f.members.length} files`,
            );
            // The header counts the WHOLE SCC, so list its members — the
            // shortest loop below is one example path, not the full cycle.
            const shown =
                f.members.length <= MEMBER_CAP
                    ? f.members
                    : f.members.slice(0, MEMBER_CAP);
            const more =
                f.members.length > MEMBER_CAP
                    ? `, … +${f.members.length - MEMBER_CAP} more`
                    : '';
            lines.push(`  members: ${shown.join(', ')}${more}`);
            lines.push(`  example loop (shortest): ${f.shortestPath.join(' -> ')}`);
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

    // §3 Duplication (Loop 06 exact-body + Loop 07 shared-literal). Clusters are
    // already combined + ranked by `findClones` (severity band → strength → id);
    // the renderer must NOT re-sort. Deterministic, no timestamp.
    lines.push('');
    lines.push('## 3. Duplication');
    const clones = report.clones;
    if (clones.length === 0) {
        lines.push('No duplication found.');
    } else {
        lines.push(`Found ${clones.length} clone cluster(s):`);
        clones.forEach((c, i) => {
            lines.push('');
            const note =
                c.severity === 'low' ? ' [sibling-boilerplate]' : '';
            const kind =
                c.cloneType === 'shared-literal'
                    ? ` [shared-literal: ${c.sharedKind}]`
                    : '';
            lines.push(
                `Cluster ${i + 1} (${c.severity})${kind}${note}: ${c.members.length} members`,
            );
            lines.push(`  members: ${c.members.join(', ')}`);
            lines.push(`  files: ${c.relatedFiles.join(', ')}`);
        });
    }

    // Order-preserving: the hubs array is already sorted by metrics.ts (degree
    // desc, id asc) — do NOT re-sort.
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

    // §5 Module interfaces (Loop 05 interface-width). The findings array is
    // id-sorted by the analyzer; each sub-list re-sorts LOCALLY by its display
    // metric (stable, deterministic). No per-file dump — three compact lists:
    // the actionable shallow-wide folders, a widest-folder context window, and
    // the informational shared-utility function surfaces.
    const iw = report.interfaceWidth;
    const folderFindings = iw.filter(f => f.scope === 'folder');
    const fnFindings = iw.filter(f => f.scope === 'function');

    const widthRow = (
        f: { module: string; w: number; wEff: number; moduleDepth: number; dmr: number },
    ): string =>
        `| ${f.module} | ${f.w} | ${f.wEff.toFixed(2)} | ${f.moduleDepth} | ${f.dmr.toFixed(2)} |`;

    lines.push('');
    lines.push('## 5. Module interfaces');

    // (a) Shallow-wide modules — the actionable smell list.
    lines.push('');
    lines.push('### Shallow-wide modules');
    const shallowWide = folderFindings
        .filter(f => f.severity === 'medium')
        .sort((a, b) => b.wEff - a.wEff || a.module.localeCompare(b.module));
    if (shallowWide.length === 0) {
        lines.push('No shallow-wide modules.');
    } else {
        lines.push('| Module | W | W_eff | Depth | DMR |');
        lines.push('| --- | --- | --- | --- | --- |');
        shallowWide.forEach(f => lines.push(widthRow(f)));
    }

    // (b) Widest folders (context) — top 8 folder findings by W_eff (w > 0).
    lines.push('');
    lines.push('### Widest folders (context)');
    const widestFolders = folderFindings
        .filter(f => f.w > 0)
        .sort((a, b) => b.wEff - a.wEff || a.module.localeCompare(b.module))
        .slice(0, 8);
    if (widestFolders.length === 0) {
        lines.push('No folder interfaces measured.');
    } else {
        lines.push('| Module | W | W_eff | Depth | DMR |');
        lines.push('| --- | --- | --- | --- | --- |');
        widestFolders.forEach(f => lines.push(widthRow(f)));
    }

    // (c) Shared-utility surfaces (informational) — top 8 function findings by
    // cross-file inbound (topEntryPoints[0].inbound) desc.
    lines.push('');
    lines.push('### Shared-utility surfaces (informational)');
    const widestFns = fnFindings
        .map(f => ({ module: f.module, inbound: f.topEntryPoints[0]?.inbound ?? 0 }))
        .sort((a, b) => b.inbound - a.inbound || a.module.localeCompare(b.module))
        .slice(0, 8);
    if (widestFns.length === 0) {
        lines.push('No shared-utility surfaces.');
    } else {
        lines.push('| Function | cross-file inbound |');
        lines.push('| --- | --- |');
        widestFns.forEach(f => lines.push(`| ${f.module} | ${f.inbound} |`));
    }

    return lines.join('\n');
}
