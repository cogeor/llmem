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

import { buildGraphsFromSplitEdgeLists } from '../../graph';
import { ImportEdgeListStore, CallEdgeListStore } from '../../graph/edgelist';
import { ImportGraph } from '../../graph/types';
import { importCyclesFromGraph } from '../../application/analysis';
import { detectWorkspace } from '../../workspace';
import type { CommandSpec } from '../registry';
import { ensureGraph } from './ensure-graph';

/**
 * Render an `ImportGraph` into the printable cycle report.
 *
 * PURE + deterministic. Delegates the SCC pipeline to the shared analyzer
 * (`importCyclesFromGraph` in `src/application/analysis/cycles.ts`) — which runs
 * the same `excludeAggregatorEdges -> nonTrivialSccs -> shortestCyclePath` —
 * and formats its `CycleFinding[]` identically to the pre-Loop-02 inline
 * version. If there are no cycles, returns exactly `No import cycles found.`.
 * Otherwise emits a header plus one block per SCC (engine's already-sorted
 * order): the sorted member list and the closed hop chain
 * (`id0 -> id1 -> ... -> id0`).
 *
 * Byte-identity: the analyzer builds `shortestPath` as
 * `[hops[0].source, ...hops.map(h => h.target)]` — exactly the old hop join —
 * and falls back to `[...scc]` (length === members) when there are zero hops, so
 * guarding on `shortestPath.length > 1` reproduces the old `(members: ...)`
 * branch for that degenerate case. `tests/unit/cli/find-cycles.test.ts` pins it.
 */
export function buildCycleReport(importGraph: ImportGraph): string {
    const cycles = importCyclesFromGraph(importGraph);

    if (cycles.length === 0) {
        return 'No import cycles found.';
    }

    const lines: string[] = [];
    lines.push(`Found ${cycles.length} import cycle(s):`);

    cycles.forEach((c, i) => {
        lines.push('');
        lines.push(`Cycle ${i + 1} (${c.members.length} files): ${c.members.join(', ')}`);

        if (c.shortestPath.length > 1) {
            lines.push(`  ${c.shortestPath.join(' -> ')}`);
        } else {
            // Defensive: a non-trivial SCC should always yield a closed chain.
            lines.push(`  (members: ${c.members.join(', ')})`);
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

        const ctx = await cli.createWorkspace(workspace);

        // A5: zero-config — auto-scan on first run instead of demanding a
        // prior `llmem scan`. Probes ctx.config.artifactRoot (bug 1.3).
        await ensureGraph(ctx, { requireGraph: true });

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
