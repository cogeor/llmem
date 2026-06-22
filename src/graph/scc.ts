// src/graph/scc.ts
//
// Strongly-connected-component (cycle) engine over the existing ImportGraph.
//
// Ported from `../aipr/tests/arch/_depgraph.py` (the codebase-AGNOSTIC depgraph
// engine). This module is PURE and dependency-free: it imports ONLY the graph
// type shapes from `./types`. No node:*/fs/path/parser/vscode/contracts/webview
// imports. Node ids are opaque strings (repo-relative POSIX paths for files,
// bare specifiers for externals); the engine never interprets them beyond
// string equality and `id.split('/')` for the aggregator basename heuristic.
//
// It consumes `ImportGraph` directly — there is deliberately NO intermediate
// Graph/Edge class (aipr's `Graph`). The successor adjacency is built straight
// from `graph.edges` (see `buildSuccessorMap`) and fed to an ITERATIVE Tarjan
// (aipr lines 104-165) so there is no recursion-depth limit on large graphs.
//
// Key decisions (locked, do not silently change):
// - Self-loop semantics: a single node A with edge A->A is a NON-TRIVIAL
//   (cyclic) SCC. `tarjanSccs` returns it as ['A'] (size 1); `nonTrivialSccs`
//   KEEPS it because a self-loop exists; `computeInCycleEdgeKeys` emits 'A->A'.
// - In-cycle edge keys are computed on the POST-EXCLUSION graph: an edge dropped
//   by `excludeAggregatorEdges` can never be in-cycle, even if its endpoints
//   were part of a cycle that ran through an aggregator/barrel node. That is the
//   entire point of the exclusion pass.
// - `computeInCycleEdgeKeys` is the SINGLE SOURCE OF TRUTH; `edgeInCycle`
//   delegates to it (computes once, closes over the resulting Set) so the two
//   consumer helpers can never diverge.
// - Determinism everywhere: successors sorted+deduped, Tarjan roots iterate
//   `[...graph.nodes.keys()].sort()`, each component sorted ascending, and the
//   component list ordered by each component's smallest id.
//
// shortestCyclePath (aipr lines 168-207) is DEFERRED to Loop 03; if added it
// returns ImportEdge[] node-id hops (ImportEdge has no file/line).

import { ImportGraph, ImportEdge } from './types';

/**
 * Sorted, deduped successor adjacency built from `graph.edges`.
 *
 * Keys = every node id that appears as an edge SOURCE; values = the sorted
 * unique set of that source's targets. A node with no out-edges simply has no
 * key here — `tarjanSccs` still visits it because it iterates `graph.nodes`.
 */
export function buildSuccessorMap(graph: ImportGraph): Map<string, string[]> {
    const succ = new Map<string, string[]>();
    for (const e of graph.edges) {
        const arr = succ.get(e.source);
        if (arr) {
            arr.push(e.target);
        } else {
            succ.set(e.source, [e.target]);
        }
    }
    for (const [src, targets] of succ) {
        succ.set(src, [...new Set(targets)].sort());
    }
    return succ;
}

/**
 * Every strongly-connected component of `graph`, including size-1 components.
 *
 * Iterative Tarjan (no recursion-depth limit — ports aipr `tarjan_sccs` lines
 * 104-165 as an explicit work-stack of `[node, position]` frames). Output is
 * stable across runs: roots iterate `[...graph.nodes.keys()].sort()`, each
 * component is sorted ascending, and the component list is ordered by each
 * component's smallest node id.
 *
 * A component of size > 1, or a single node with a self-loop, is a dependency
 * cycle — see `nonTrivialSccs`.
 */
export function tarjanSccs(graph: ImportGraph): string[][] {
    const successors = buildSuccessorMap(graph);

    const indexOf = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    let counter = 0;
    const sccs: string[][] = [];

    const roots = [...graph.nodes.keys()].sort();

    for (const root of roots) {
        if (indexOf.has(root)) {
            continue;
        }
        // work stack holds [node, iterator-position] frames.
        const work: Array<[string, number]> = [[root, 0]];
        const succCache = new Map<string, string[]>();

        while (work.length > 0) {
            const frame = work[work.length - 1];
            const node = frame[0];
            const pos = frame[1];

            if (pos === 0) {
                indexOf.set(node, counter);
                lowlink.set(node, counter);
                counter += 1;
                stack.push(node);
                onStack.add(node);
                succCache.set(node, successors.get(node) ?? []);
            }

            const succs = succCache.get(node)!;
            if (pos < succs.length) {
                frame[1] = pos + 1;
                const nxt = succs[pos];
                if (!indexOf.has(nxt)) {
                    work.push([nxt, 0]);
                } else if (onStack.has(nxt)) {
                    lowlink.set(node, Math.min(lowlink.get(node)!, indexOf.get(nxt)!));
                }
                continue;
            }

            // Done with node: settle its lowlink against children, maybe close SCC.
            work.pop();
            if (work.length > 0) {
                const parent = work[work.length - 1][0];
                lowlink.set(parent, Math.min(lowlink.get(parent)!, lowlink.get(node)!));
            }
            if (lowlink.get(node) === indexOf.get(node)) {
                const component: string[] = [];
                for (;;) {
                    const w = stack.pop()!;
                    onStack.delete(w);
                    component.push(w);
                    if (w === node) {
                        break;
                    }
                }
                sccs.push(component.sort());
            }
        }
    }

    sccs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return sccs;
}

/**
 * The cyclic subset of `tarjanSccs(graph)`, in the same order.
 *
 * A component is a CYCLE iff its size > 1, OR its size === 1 and that single
 * node has a self-loop edge (n -> n) in `graph.edges`. (Self-loop semantics:
 * A->A IS a non-trivial / cyclic SCC and is retained here.)
 */
export function nonTrivialSccs(graph: ImportGraph): string[][] {
    const selfLoops = new Set(
        graph.edges.filter(e => e.source === e.target).map(e => e.source),
    );
    return tarjanSccs(graph).filter(
        c => c.length > 1 || (c.length === 1 && selfLoops.has(c[0])),
    );
}

// The one project-specific heuristic: aggregator / barrel re-export nodes. A
// node whose POSIX basename is one of these re-exports its members, so an edge
// touching it is an idiomatic re-export, NOT an architectural cycle.
const AGGREGATOR_BASENAMES = new Set([
    'index.ts',
    'index.tsx',
    'index.js',
    'index.jsx',
    '__init__.py',
    '__init__.pyi',
]);

/**
 * Pure string predicate: is `id` an aggregator/barrel node?
 *
 * Aggregator iff the POSIX basename is one of `index.{ts,tsx,js,jsx}` or
 * `__init__.{py,pyi}`. Basename = `id.split('/').pop() ?? id` — ids are
 * repo-relative POSIX paths even on Windows (they come from the edge list, not
 * the OS), so we split on '/' only and never import `node:path`. Case-sensitive
 * exact match.
 */
export function isAggregatorNode(id: string): boolean {
    const base = id.split('/').pop() ?? id;
    return AGGREGATOR_BASENAMES.has(base);
}

/**
 * A node-preserving COPY of `graph` with every edge whose source OR target is an
 * aggregator removed. The nodes Map is cloned in full (all nodes preserved so
 * the remaining graph still spans the whole id space); the input is never
 * mutated. Mirrors aipr `exclude_package_reexport_edges`.
 */
export function excludeAggregatorEdges(graph: ImportGraph): ImportGraph {
    return {
        nodes: new Map(graph.nodes),
        edges: graph.edges.filter(
            e => !isAggregatorNode(e.source) && !isAggregatorNode(e.target),
        ),
    };
}

/**
 * The consumer-facing in-cycle helper Loop 02 calls VERBATIM.
 *
 * Pipeline: `excludeAggregatorEdges` -> `nonTrivialSccs` -> for each cyclic SCC,
 * emit a key `${source}->${target}` for EVERY post-exclusion edge whose BOTH
 * endpoints sit in that same SCC. An edge is in a cycle iff, ON THE POST-
 * EXCLUSION GRAPH, both endpoints belong to the same non-trivial SCC.
 *
 * Self-loop A->A yields the key 'A->A' (it is a non-trivial SCC of size 1).
 * Edges dropped by the exclusion pass are absent from `g.edges` and can never
 * be in-cycle — that is the point of exclusion.
 */
export function computeInCycleEdgeKeys(graph: ImportGraph): Set<string> {
    const g = excludeAggregatorEdges(graph);
    const sccs = nonTrivialSccs(g);

    // node id -> index of the cyclic SCC it belongs to (cyclic SCCs only).
    const memberToScc = new Map<string, number>();
    sccs.forEach((component, i) => {
        for (const id of component) {
            memberToScc.set(id, i);
        }
    });

    const keys = new Set<string>();
    for (const e of g.edges) {
        const s = memberToScc.get(e.source);
        const t = memberToScc.get(e.target);
        if (s !== undefined && s === t) {
            keys.add(`${e.source}->${e.target}`);
        }
    }
    return keys;
}

/**
 * Convenience predicate over the SAME computation as `computeInCycleEdgeKeys`.
 * Computes the in-cycle key set once and closes over it, so this can never
 * diverge from `computeInCycleEdgeKeys` (the single source of truth). Loop 02
 * may use either form.
 */
export function edgeInCycle(
    graph: ImportGraph,
): (source: string, target: string) => boolean {
    const keys = computeInCycleEdgeKeys(graph);
    return (source: string, target: string) => keys.has(`${source}->${target}`);
}
