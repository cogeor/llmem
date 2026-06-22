/**
 * `llmem find-cycles` — report import dependency cycles.
 *
 * Loop 03 (cycle-detection-red-edges). Loads the import graph for a scanned
 * workspace, runs the pure SCC engine (`src/graph/scc.ts`), and prints a
 * deterministic, human/LLM-digestible report: each non-trivial SCC's members
 * and the shortest closed hop chain through it.
 *
 * The report body (`buildCycleReport`) is a PURE exported function so the unit
 * test imports it directly and never spawns `dist/cli/main.js`. The SCC engine
 * stays free of presentation concerns — formatting lives here.
 *
 * ImportEdge has no file/line, so hops print repo-relative node ids only.
 */

import { z } from 'zod';

import { hasEdgeLists } from '../../viewer-generator';
import { buildGraphsFromSplitEdgeLists } from '../../graph';
import { ImportEdgeListStore, CallEdgeListStore } from '../../graph/edgelist';
import { ImportGraph } from '../../graph/types';
import {
    excludeAggregatorEdges,
    nonTrivialSccs,
    shortestCyclePath,
} from '../../graph/scc';
import { detectWorkspace } from '../../workspace';
import type { CommandSpec } from '../registry';
import { CliError } from '../errors';

/**
 * Render an `ImportGraph` into the printable cycle report.
 *
 * PURE + deterministic. Runs `excludeAggregatorEdges` then `nonTrivialSccs`
 * (consistent with `computeInCycleEdgeKeys`). If there are no cycles, returns
 * exactly `No import cycles found.`. Otherwise emits a header plus one block per
 * SCC (in the engine's already-sorted order): the sorted member list and the
 * closed hop chain from `shortestCyclePath` (`id0 -> id1 -> ... -> id0`).
 */
export function buildCycleReport(importGraph: ImportGraph): string {
    const g = excludeAggregatorEdges(importGraph);
    const sccs = nonTrivialSccs(g);

    if (sccs.length === 0) {
        return 'No import cycles found.';
    }

    const lines: string[] = [];
    lines.push(`Found ${sccs.length} import cycle(s):`);

    sccs.forEach((scc, i) => {
        lines.push('');
        lines.push(`Cycle ${i + 1} (${scc.length} files): ${scc.join(', ')}`);

        const hops = shortestCyclePath(g, scc);
        if (hops.length > 0) {
            const path = [hops[0].source, ...hops.map(h => h.target)].join(' -> ');
            lines.push(`  ${path}`);
        } else {
            // Defensive: a non-trivial SCC should always yield a closed chain.
            lines.push(`  (members: ${scc.join(', ')})`);
        }
    });

    return lines.join('\n');
}

const findCyclesArgs = z.object({
    workspace: z.string().optional(),
});

export const findCyclesCommand: CommandSpec<typeof findCyclesArgs> = {
    name: 'find-cycles',
    description: 'Report import dependency cycles',
    examples: [
        {
            scenario: 'List import cycles in the auto-detected workspace',
            command: 'llmem find-cycles',
        },
    ],
    args: findCyclesArgs,
    async run(args, cli) {
        const workspace = detectWorkspace(args.workspace);

        if (!hasEdgeLists(workspace)) {
            throw new CliError('Error: No edge lists found. Please scan workspace first.', 1);
        }

        const ctx = await cli.createWorkspace(workspace);

        const importStore = new ImportEdgeListStore(ctx.artifactRoot, ctx.io);
        const callStore = new CallEdgeListStore(ctx.artifactRoot, ctx.io);
        await importStore.load();
        await callStore.load();

        const { importGraph } = buildGraphsFromSplitEdgeLists(
            importStore.getData(),
            callStore.getData(),
        );

        console.log(buildCycleReport(importGraph));
    },
};
