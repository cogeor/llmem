/**
 * Review recall pass (WS-2).
 *
 * Wires each `REVIEW_REGISTRY` item to the SHIPPED health analyzers and produces
 * a `ReviewChecklist` for one reviewed `path`. The checklist ALWAYS carries
 * every registry item in the selected ruleset (the no-skip device) — `scope`
 * governs candidate GRANULARITY, never item inclusion (PLAN 02 design decision).
 *
 * Recall map (item.recallQuery → report source):
 *   - `'cycles'`          → importCycles ∪ callCycles ∪ recursion (DEP1)
 *   - `'clones'`          → clones (D1)
 *   - `'interface-width'` → interfaceWidth (ENC3, FI1)
 *   - everything else (`'instruction'` + any not-yet-built signal) → graph-blind
 *
 * graphBlind === true ⇔ the recallQuery is NOT one of the built sources, OR it
 * is built but yields ZERO candidates under the subtree filter. "0 candidates"
 * is ALWAYS graph-blind (so the renderer says "read for it", never "clean").
 *
 * Determinism: no `Date` / `Math.random`. Entries follow REVIEW_REGISTRY order;
 * each entry's candidates are sorted (ref then note) and deduped. `JSON.stringify`
 * of the result is byte-stable across runs on identical input.
 *
 * PURE/wrapper split mirrors `interfaceWidthFromGraph` vs `computeInterfaceWidth`:
 * `reviewRecallFromReport` is the IO-free core (unit-tested with hand-built
 * fixtures); `runReviewRecall` is the thin ctx-loading wrapper.
 */

import type { WorkspaceContext } from '../workspace-context';
import { loadGraphs } from '../analysis/load-graphs';
import type { ImportGraph } from '../../graph/types';
import type {
    HealthReport,
    Finding,
    CycleFinding,
    CloneFinding,
    InterfaceWidthFinding,
} from '../analysis/types';
import { runHealthScan } from '../analysis/health';
import { REVIEW_REGISTRY } from './registry';
import type {
    ChecklistEntry,
    RecallCandidate,
    ReviewChecklist,
} from './types';
import { detectPathKind, isUnderPath, normalizeReviewPath } from './scope';
import {
    ALL_SCANNERS,
    loadScopedSources,
    runSignalScanners,
} from './signals';
import {
    CAPPED_ITEM_IDS,
    REVIEW_CANDIDATE_CAP,
    capCandidates,
    keepCloneFinding,
    keepWidthFinding,
    toFileId,
} from './recall-gate';

/** Thrown by the wrapper when the workspace has no edge lists to scan. */
export class ReviewRecallError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ReviewRecallError';
    }
}

/**
 * The recallQuery values backed by a shipped analyzer this loop. Any other
 * value (`'instruction'` + not-yet-built signal names) falls to graph-blind.
 */
const BUILT_QUERIES: ReadonlySet<string> = new Set([
    'cycles',
    'clones',
    'interface-width',
]);

/**
 * The set of file ids a finding "touches" — the subtree-filter probe. Members
 * (cycles/clones) and the width `module` may be entity ids; `relatedFiles` are
 * already file ids. All are reduced to file ids so the same `isUnderPath` gate
 * applies to every source.
 */
function findingFiles(finding: Finding): string[] {
    const files = new Set<string>();
    for (const f of finding.relatedFiles) {
        files.add(toFileId(f));
    }
    const members = (finding as { members?: string[] }).members;
    if (members) {
        for (const m of members) {
            files.add(toFileId(m));
        }
    }
    const moduleId = (finding as { module?: string }).module;
    if (moduleId) {
        files.add(toFileId(moduleId));
    }
    return [...files];
}

/** True iff any file the finding touches is under the reviewed subtree. */
function findingUnderPath(
    finding: Finding,
    reviewPath: string,
    pathKind: 'file' | 'folder',
): boolean {
    return findingFiles(finding).some(file =>
        isUnderPath(file, reviewPath, pathKind),
    );
}

/** Sort + dedupe candidates by `ref` then `note` (deterministic). */
function sortDedupeCandidates(
    candidates: RecallCandidate[],
): RecallCandidate[] {
    const seen = new Set<string>();
    const unique: RecallCandidate[] = [];
    for (const c of candidates) {
        const key = `${c.ref} ${c.note ?? ''}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        unique.push(c);
    }
    unique.sort(
        (a, b) =>
            a.ref.localeCompare(b.ref) ||
            (a.note ?? '').localeCompare(b.note ?? ''),
    );
    return unique;
}

/**
 * PURE core: build the `ReviewChecklist` for `path` from an already-computed
 * `HealthReport` + `ImportGraph`. No IO, no ctx. ALL mapping / filter / scope
 * logic lives here.
 */
export function reviewRecallFromReport(
    report: HealthReport,
    importGraph: ImportGraph,
    path: string,
    ruleset: 'general' | 'frontend' | 'both',
    graphSnapshot?: string,
): ReviewChecklist {
    const normalized = normalizeReviewPath(path);
    const pathKind = detectPathKind(importGraph, normalized);

    // Build the candidate map keyed by recallQuery, applying the subtree filter
    // at construction time so the entry loop only reads pre-filtered lists.
    const candidatesByQuery = new Map<string, RecallCandidate[]>();

    const collect = (
        query: string,
        findings: readonly Finding[],
        ref: (f: Finding) => string,
    ): void => {
        const list = candidatesByQuery.get(query) ?? [];
        for (const finding of findings) {
            if (!findingUnderPath(finding, normalized, pathKind)) {
                continue;
            }
            list.push({ ref: ref(finding), note: finding.title });
        }
        candidatesByQuery.set(query, list);
    };

    // 'cycles' → DEP1: import cycles ∪ call cycles ∪ recursion. ref = finding.id.
    const cycleFindings: Finding[] = [
        ...(report.importCycles as CycleFinding[]),
        ...(report.callCycles as CycleFinding[]),
        ...((report.recursion ?? []) as Finding[]),
    ];
    collect('cycles', cycleFindings, f => f.id);

    // 'clones' → D1. ref = finding.id.
    collect('clones', report.clones as CloneFinding[], f => f.id);

    // 'interface-width' → ENC3 + FI1. ref = finding.module (the reviewed unit).
    collect(
        'interface-width',
        report.interfaceWidth as InterfaceWidthFinding[],
        f => (f as InterfaceWidthFinding).module,
    );

    // Gated, per-item candidate sources for the capped analyzer items (FI1, D1).
    // Built from the SAME raw findings + subtree filter as `collect`, but with a
    // low-signal gate predicate applied so the flood is trimmed before the cap.
    // Keyed on `item.id` — NOT the shared `interface-width` query bucket — so
    // ENC3 (which also reads 'interface-width') keeps its full ungated list.
    const fi1Raw: RecallCandidate[] = (
        report.interfaceWidth as InterfaceWidthFinding[]
    )
        .filter(f => findingUnderPath(f, normalized, pathKind) && keepWidthFinding(f))
        .map(f => ({ ref: f.module, note: f.title }));

    const d1Raw: RecallCandidate[] = (report.clones as CloneFinding[])
        .filter(f => findingUnderPath(f, normalized, pathKind) && keepCloneFinding(f))
        .map(f => ({ ref: f.id, note: f.title }));

    const gatedById = new Map<string, RecallCandidate[]>([
        ['FI1', fi1Raw],
        ['D1', d1Raw],
    ]);

    // Assemble entries in REVIEW_REGISTRY order, filtered by ruleset.
    const entries: ChecklistEntry[] = [];
    for (const item of REVIEW_REGISTRY) {
        if (ruleset !== 'both' && item.ruleset !== ruleset) {
            continue;
        }

        const built = BUILT_QUERIES.has(item.recallQuery);
        const gated = gatedById.get(item.id);
        const raw = gated ?? (built ? candidatesByQuery.get(item.recallQuery) ?? [] : []);
        const sorted = sortDedupeCandidates(raw);
        const { candidates, capped } = gated
            ? capCandidates(sorted, REVIEW_CANDIDATE_CAP)
            : { candidates: sorted, capped: undefined };

        // graphBlind: query not built, OR built but zero candidates here (a gate
        // can drop a gated item to zero — it stays graph-blind, never skipped). A
        // built analyzer that legitimately yields zero for this path is STILL
        // graph-blind ("0 = read for it", never "clean").
        const graphBlind = !built || candidates.length === 0;

        entries.push({
            item,
            candidates,
            status: 'not-yet-checked',
            graphBlind,
            capped,
        });
    }

    return { path: normalized, scope: pathKind, ruleset, entries, graphSnapshot };
}

/**
 * PURE fold: APPEND review-time signal candidates onto a checklist.
 *
 * For each entry whose `item.id` is in `signalMap` with ≥1 candidate, the signal
 * candidates are APPENDED to the entry's existing candidates (dedupe by ref+note,
 * re-sorted) and `graphBlind` is set to `false`. APPEND — never replace — so
 * analyzer-fed items (e.g. FI1's interface-width candidates) keep BOTH their
 * analyzer candidates and any signal candidates. Entries with no signal hit pass
 * through untouched.
 *
 * IO-free and deterministic, mirroring `reviewRecallFromReport`: same input →
 * byte-identical output. The wrapper supplies `signalMap` from
 * `runSignalScanners`; tests build it by hand.
 */
export function mergeSignals(
    checklist: ReviewChecklist,
    signalMap: Map<string, RecallCandidate[]>,
): ReviewChecklist {
    const entries: ChecklistEntry[] = checklist.entries.map(entry => {
        const signals = signalMap.get(entry.item.id);
        if (!signals || signals.length === 0) {
            return entry;
        }
        const merged = sortDedupeCandidates([
            ...entry.candidates,
            ...signals,
        ]);
        // For capped items (FI1, D1), appending signal candidates can push the
        // merged list back over the cap. Re-cap the merged-and-sorted list so the
        // FINAL emitted candidates are the top-N and `capped.total` is the honest
        // post-merge total. Non-capped items keep `capped` undefined.
        if (CAPPED_ITEM_IDS.has(entry.item.id)) {
            const { candidates, capped } = capCandidates(
                merged,
                REVIEW_CANDIDATE_CAP,
            );
            return { ...entry, candidates, graphBlind: false, capped };
        }
        return { ...entry, candidates: merged, graphBlind: false };
    });
    return { ...checklist, entries };
}

/**
 * Thin wrapper: load the edge stores, build the import + call graphs, run the
 * health scan, delegate to the pure `reviewRecallFromReport`, then run the
 * review-time signal scanners over the in-scope source files and fold their
 * candidates in with the pure `mergeSignals`. Mirrors `computeInterfaceWidth(ctx)`.
 * Guards missing edge lists with a typed error the caller messages (cf.
 * `src/cli/commands/health.ts`).
 */
export async function runReviewRecall(
    ctx: WorkspaceContext,
    path: string,
    ruleset: 'general' | 'frontend' | 'both',
): Promise<ReviewChecklist> {
    // D1: one load feeds the recall AND the health scan (previously this
    // built its own graph and runHealthScan loaded four more).
    const graphs = await loadGraphs(ctx);
    if (graphs.importNodeCount === 0) {
        throw new ReviewRecallError(
            'No edge lists found. Please scan workspace first.',
        );
    }

    // The import-edgelist JSON already carries an ISO `timestamp`; surface it as
    // the graph-snapshot note. Deterministic-by-data — no `fs.stat`, no `Date`.
    const graphSnapshot = graphs.timestamp;
    const importGraph = graphs.importGraph;

    const report = await runHealthScan(ctx, { graphs });
    const checklist = reviewRecallFromReport(
        report,
        importGraph,
        path,
        ruleset,
        graphSnapshot,
    );

    // WS-4: review-time text-scan signals over the in-scope source files. The
    // sources are loaded once (the harness's only IO) and folded in purely.
    const sources = await loadScopedSources(
        ctx,
        importGraph,
        checklist.path,
        checklist.scope === 'repo' ? 'folder' : checklist.scope,
    );
    const signalMap = runSignalScanners(sources, ALL_SCANNERS);
    return mergeSignals(checklist, signalMap);
}
