/**
 * Interface-width pure core (W1/W2/W3-ent/W4) — Loop 02.
 *
 * Deterministic, IO-free analyzer that takes already-built graphs and emits
 * `InterfaceWidthFinding[]`. Measures the "surface area" through which each
 * module is reached from OUTSIDE.
 *
 * Substrate split (spec §1.4 choice 2):
 *  - FILE and FOLDER modules are measured over the IMPORT graph (file→file
 *    edges only — external/dangling endpoints are skipped, mirroring the hub
 *    analyzer's `node.kind === 'file'` gate at metrics.ts:55-60).
 *  - FUNCTION modules are measured over the CALL graph (a function's inbound
 *    "external" callers = call edges whose source entity lives in a DIFFERENT
 *    `fileId`).
 *
 * Module model: every FILE id PLUS every ancestor FOLDER prefix (`src`,
 * `src/graph`, `src/graph/edge-list`, …) PLUS every entity (function scope).
 * "External" is relative to the module being measured — an edge internal to
 * `src/graph/` is inbound-external for `src/graph/edge-list/`; both findings
 * are emitted.
 *
 * Metrics:
 *  - W1 `w`           = |EP(M)|, distinct external entry points.
 *  - W2 `wEff`        = 1 / Σ p_e²  (inverse-Simpson over inbound shares).
 *  - W3 `moduleDepth` = entity-count of the module's full subtree.
 *  - W4 `dmr`         = moduleDepth / wEff.
 *
 * `treeDepth`: top source segment = 0 (`src`=0, `src/graph`=1,
 * `src/graph/edge-list`=2). A file inherits its directory's depth; a function
 * inherits the depth of its `fileId`.
 *
 * Determinism contract: no `Date` / `Date.now` / `new Date` / `Math.random`.
 * Findings sorted by `id` ascending. `wEff`/`dmr` stored as raw numbers
 * (`toFixed` is only applied in the title/detail STRINGS). `JSON.stringify` of
 * the result is byte-stable across runs on the same input.
 */

import type { CallGraph, ImportGraph } from '../../graph/types';
import type { InterfaceWidthFinding, Severity } from './types';

/**
 * Loop-02 placeholder severity. Width findings RANK (they do not gate), so the
 * real signal is the metric numbers. Loop 04 replaces this constant with
 * percentile cutoffs over the live distribution.
 */
const PLACEHOLDER_SEVERITY: Severity = 'low';

/** Cap on `topEntryPoints` length (most-trafficked doors first). */
const TOP_N = 5;

interface WidthMetrics {
    w: number;
    wEff: number;
    topEntryPoints: { entity: string; inbound: number }[];
}

/**
 * Pure: given a map `entryId → Ein` (inbound-external edge count; the map only
 * holds members with `Ein > 0`), derive W1 (`w`), W2 (`wEff`, inverse-Simpson)
 * and the sorted `topEntryPoints`.
 *
 * Inverse-Simpson sanity: one entry with all traffic ⇒ Σ p² = 1 ⇒ wEff = 1;
 * eight entries each 1/8 ⇒ Σ p² = 8·(1/64) = 1/8 ⇒ wEff = 8.
 */
function widthMetrics(einByEntry: Map<string, number>): WidthMetrics {
    const w = einByEntry.size;
    if (w === 0) {
        return { w: 0, wEff: 0, topEntryPoints: [] };
    }
    let total = 0;
    for (const ein of einByEntry.values()) {
        total += ein;
    }
    let sumSq = 0;
    for (const ein of einByEntry.values()) {
        const p = ein / total;
        sumSq += p * p;
    }
    const wEff = sumSq === 0 ? 0 : 1 / sumSq;

    const topEntryPoints = [...einByEntry.entries()]
        .map(([entity, inbound]) => ({ entity, inbound }))
        .sort((a, b) => b.inbound - a.inbound || a.entity.localeCompare(b.entity))
        .slice(0, TOP_N);

    return { w, wEff, topEntryPoints };
}

/**
 * `treeDepth` of a FOLDER prefix: number of `/` separators counting the top
 * source segment as 0 (`src`=0, `src/graph`=1, `src/graph/edge-list`=2).
 */
function folderTreeDepth(prefix: string): number {
    return prefix.split('/').length - 1;
}

/**
 * `treeDepth` of a FILE / entity, inheriting its CONTAINING DIRECTORY's depth
 * (a file in `src/p/edge-list/` is depth 2, not 3 — the basename does not add a
 * level). Functions inherit the depth of their `fileId`.
 */
function fileTreeDepth(fileId: string): number {
    // Drop the basename; the directory prefix carries the depth.
    return Math.max(0, fileId.split('/').length - 2);
}

/**
 * Pure: derive interface-width findings from already-built graphs.
 *
 * File & folder width over the import graph; function width over the call
 * graph. Function-scope modules with `w === 0` are PRUNED (a function reachable
 * only from its own file has no external interface and would balloon the output
 * on a real repo); file/folder modules are always emitted (rank-don't-gate,
 * D4 reports the root). See IMPLEMENTATION.md note.
 */
export function interfaceWidthFromGraph(
    callGraph: CallGraph,
    importGraph: ImportGraph,
): InterfaceWidthFinding[] {
    // ---- (A) Module enumeration -------------------------------------------

    const isFileNode = (id: string): boolean =>
        importGraph.nodes.get(id)?.kind === 'file';

    // File modules = the import-graph file ids. Folder modules = every ancestor
    // `/`-prefix of every file id.
    const fileModules: string[] = [];
    const folderModules = new Set<string>();
    for (const [id, node] of importGraph.nodes) {
        if (node.kind !== 'file') {
            continue;
        }
        fileModules.push(id);
        const parts = id.split('/');
        // Drop the basename; accumulate ancestor folder prefixes.
        for (let i = 1; i < parts.length; i++) {
            folderModules.add(parts.slice(0, i).join('/'));
        }
    }

    // fileId → entity count (built from the call graph). Drives W3 subtree depth.
    const entityCountByFile = new Map<string, number>();
    for (const entity of callGraph.nodes.values()) {
        entityCountByFile.set(
            entity.fileId,
            (entityCountByFile.get(entity.fileId) ?? 0) + 1,
        );
    }

    // ---- (B) Boundary computation: FILE & FOLDER (import substrate) --------

    // For a file module M, an import edge s→t is inbound-external iff t === M
    // and s !== M. For a folder module M, membership is `id === M || id starts
    // with M + '/'`. Only file→file edges count.
    const fileEin = new Map<string, Map<string, number>>(); // module → (entry → Ein)
    const folderEin = new Map<string, Map<string, number>>();

    const bump = (
        store: Map<string, Map<string, number>>,
        module: string,
        entry: string,
    ): void => {
        let m = store.get(module);
        if (!m) {
            m = new Map<string, number>();
            store.set(module, m);
        }
        m.set(entry, (m.get(entry) ?? 0) + 1);
    };

    const inFolder = (id: string, folder: string): boolean =>
        id === folder || id.startsWith(folder + '/');

    for (const e of importGraph.edges) {
        // Mirror metrics.ts:55-60 — only file→file edges between present nodes.
        if (!isFileNode(e.source) || !isFileNode(e.target)) {
            continue;
        }

        // File module: target's own file is the entry point when source differs.
        if (e.source !== e.target) {
            bump(fileEin, e.target, e.target);
        }

        // Folder modules: edge is inbound-external when the target is inside the
        // folder but the source is NOT. Entry point = the target file id.
        for (const folder of folderModules) {
            if (inFolder(e.target, folder) && !inFolder(e.source, folder)) {
                bump(folderEin, folder, e.target);
            }
        }
    }

    // ---- (C) Boundary computation: FUNCTION (call substrate) --------------

    // Ein(e) = #{ call edges s→e : fileId(s) !== fileId(e) }. Keyed by the
    // entity itself (a function's only possible entry point is itself).
    const fnEin = new Map<string, Map<string, number>>();
    for (const e of callGraph.edges) {
        const src = callGraph.nodes.get(e.source);
        const tgt = callGraph.nodes.get(e.target);
        if (!src || !tgt) {
            continue;
        }
        if (src.fileId !== tgt.fileId) {
            bump(fnEin, tgt.id, tgt.id);
        }
    }

    // ---- W3 subtree entity-count helpers ----------------------------------

    const fileDepth = (fileId: string): number =>
        entityCountByFile.get(fileId) ?? 0;

    const folderDepth = (folder: string): number => {
        let count = 0;
        for (const [fileId, n] of entityCountByFile) {
            if (inFolder(fileId, folder)) {
                count += n;
            }
        }
        return count;
    };

    // ---- (D) Finding assembly ---------------------------------------------

    const findings: InterfaceWidthFinding[] = [];

    const push = (
        id: string,
        module: string,
        scope: 'file' | 'folder' | 'function',
        treeDepth: number,
        metrics: WidthMetrics,
        moduleDepth: number,
    ): void => {
        const { w, wEff, topEntryPoints } = metrics;
        const dmr = wEff === 0 ? 0 : moduleDepth / wEff;
        const top = topEntryPoints
            .map(t => `${t.entity}(${t.inbound})`)
            .join(', ');
        findings.push({
            id,
            type: 'interface-width',
            severity: PLACEHOLDER_SEVERITY,
            module,
            scope,
            treeDepth,
            w,
            wEff,
            moduleDepth,
            dmr,
            topEntryPoints,
            relatedFiles: [module],
            title:
                `W=${w} W_eff=${wEff.toFixed(2)} ` +
                `depth=${moduleDepth} DMR=${dmr.toFixed(2)}`,
            detail:
                `${scope} ${module}: ${w} external entry point(s), ` +
                `W_eff=${wEff.toFixed(2)} (effective doors), ` +
                `subtree=${moduleDepth} entities, DMR=${dmr.toFixed(2)}` +
                (top ? ` — top: ${top}` : ''),
        });
    };

    // File modules (always emitted).
    for (const fileId of fileModules) {
        const metrics = widthMetrics(fileEin.get(fileId) ?? new Map());
        push(
            'iw:file:' + fileId,
            fileId,
            'file',
            fileTreeDepth(fileId),
            metrics,
            fileDepth(fileId),
        );
    }

    // Folder modules (always emitted).
    for (const folder of folderModules) {
        const metrics = widthMetrics(folderEin.get(folder) ?? new Map());
        push(
            'iw:folder:' + folder,
            folder,
            'folder',
            folderTreeDepth(folder),
            metrics,
            folderDepth(folder),
        );
    }

    // Function modules (PRUNED when w === 0 — see header / IMPLEMENTATION.md).
    for (const entity of callGraph.nodes.values()) {
        const ein = fnEin.get(entity.id);
        if (!ein || ein.size === 0) {
            continue;
        }
        const metrics = widthMetrics(ein);
        push(
            'iw:fn:' + entity.id,
            entity.id,
            'function',
            fileTreeDepth(entity.fileId),
            metrics,
            1, // a function's subtree is itself (LOC depth is loop 07).
        );
    }

    // Determinism: stable order by id.
    findings.sort((a, b) => a.id.localeCompare(b.id));
    return findings;
}
