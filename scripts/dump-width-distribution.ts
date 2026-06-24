/**
 * Interface-width distribution probe (`npx ts-node scripts/dump-width-distribution.ts`).
 *
 * Productionized version of the Loop-04 measurement probe — documents how the
 * dynamic-percentile severity cutoffs were derived (D3 reproducibility). NOT
 * wired into the build; a pure dev tool.
 *
 * It reads `.llmem/graph/{import,call}-edgelist.json` directly with `fs` (so it
 * has ZERO runtime deps beyond the source build), constructs the import + call
 * graphs via `buildGraphsFromSplitEdgeLists`, runs the pure
 * `interfaceWidthFromGraph`, and prints:
 *   - W_eff / DMR quantiles (p25/p50/p75/p90/max) over folder findings w>0,
 *   - function cross-file inbound quantiles,
 *   - every folder finding the calibration promoted to 'medium' [shallow-wide].
 *
 * The edge-list JSON envelope is structurally an `EdgeListData` (nodes/edges
 * arrays); `buildGraphsFromSplitEdgeLists` only reads `.nodes` / `.edges`, so a
 * raw `JSON.parse` cast is sufficient here — no store / WorkspaceIO needed.
 *
 * Run from the repo root against the llmem graph in `.llmem/graph`. Pass an
 * alternate artifact dir as argv[2] to probe another repo's edge lists.
 */

import * as fs from 'fs';
import * as path from 'path';

import { buildGraphsFromSplitEdgeLists } from '../src/graph';
import type { EdgeListData } from '../src/graph/edgelist-schema';
import {
    interfaceWidthFromGraph,
    quantile,
} from '../src/application/analysis/interface-width';

const REPO_ROOT = path.resolve(__dirname, '..');
const graphDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(REPO_ROOT, '.llmem', 'graph');

function readEdgeList(file: string): EdgeListData {
    const p = path.join(graphDir, file);
    if (!fs.existsSync(p)) {
        console.error(`missing edge list: ${p}`);
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(p, 'utf8')) as EdgeListData;
}

function quantiles(values: number[]): string {
    const sorted = [...values].sort((a, b) => a - b);
    const q = (p: number): string => quantile(sorted, p).toFixed(2);
    const max = sorted.length ? sorted[sorted.length - 1].toFixed(2) : '0.00';
    return `n=${sorted.length}  p25=${q(0.25)}  p50=${q(0.5)}  p75=${q(0.75)}  p90=${q(0.9)}  max=${max}`;
}

const importData = readEdgeList('import-edgelist.json');
const callData = readEdgeList('call-edgelist.json');
const { importGraph, callGraph } = buildGraphsFromSplitEdgeLists(
    importData,
    callData,
);

const findings = interfaceWidthFromGraph(callGraph, importGraph);

const folders = findings.filter(f => f.scope === 'folder' && f.w > 0);
const functions = findings.filter(f => f.scope === 'function');

console.log(`interface-width distribution (graph: ${graphDir})\n`);
console.log(`FOLDER W_eff:  ${quantiles(folders.map(f => f.wEff))}`);
console.log(`FOLDER DMR:    ${quantiles(folders.map(f => f.dmr))}`);
console.log(
    `FUNC inbound:  ${quantiles(functions.map(f => f.topEntryPoints[0]?.inbound ?? 0))}`,
);

const shallowWide = findings.filter(
    f => f.scope === 'folder' && f.severity === 'medium',
);
console.log(`\nshallow-wide 'medium' folders (${shallowWide.length}):`);
for (const f of shallowWide) {
    console.log(
        `  ${f.module}  W_eff=${f.wEff.toFixed(2)} DMR=${f.dmr.toFixed(2)} depth=${f.moduleDepth} treeDepth=${f.treeDepth}`,
    );
}

const wideUtil = findings.filter(
    f => f.scope === 'function' && f.title.startsWith('[wide-utility]'),
);
console.log(`\nwide-utility functions annotated (${wideUtil.length}, stay low)`);
