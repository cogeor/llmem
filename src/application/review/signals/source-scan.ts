/**
 * Review-time source-scan harness (WS-4).
 *
 * Architecture decision (see Loop 07 PLAN): the persisted edge lists do NOT
 * retain unresolved-call callee names or property accesses, so the WS-4 signals
 * cannot be read back from the saved graph. Rather than invasive
 * scan→store→schema surgery per signal, WS-4 signals are computed at REVIEW TIME
 * as deterministic text scans over the in-scope source files. This is honest for
 * the *recall* half (noisy by construction; the LLM filter cleans it — exactly
 * the extraction-plan's stated contract) and keeps every signal self-contained
 * under `src/application/review/signals/` with ZERO parser/schema/pipeline
 * changes. The extraction-plan's persisted-AST / synthetic-edge versions remain
 * a future optimization.
 *
 * This module is the shared harness:
 *   - `loadScopedSources` is the ONLY IO touch-point — it reads the in-scope
 *     source files via `ctx.io`. Everything else (each `SignalScanner`,
 *     `runSignalScanners`) is PURE: text in, candidates out.
 *   - A `SignalScanner` consumes the loaded `ScopedSource[]` and emits
 *     `SignalResult[]` keyed by registry item id.
 *   - `runSignalScanners` runs every registered scanner, merges results by item
 *     id, and sorts + dedupes candidates so the output is byte-stable.
 *
 * Determinism: sources are sorted by `fileId`; candidates are sorted (ref then
 * note) and deduped. No `Date`, no `Math.random`.
 */

import type { WorkspaceContext } from '../../workspace-context';
import type { ImportGraph } from '../../../graph/types';
import type { ItemScope, RecallCandidate } from '../types';
import { isUnderPath } from '../scope';

/** One in-scope source file: its workspace-relative POSIX id + raw text. */
export interface ScopedSource {
    readonly fileId: string;
    readonly text: string;
}

/** A scanner's output for a single registry item id. */
export interface SignalResult {
    readonly itemId: string;
    readonly candidates: RecallCandidate[];
}

/** A pure text scanner: in-scope sources in, per-item candidates out. */
export type SignalScanner = (sources: ScopedSource[]) => SignalResult[];

/**
 * Load the source text of every file in the reviewed subtree.
 *
 * File ids come from the import-graph FILE nodes (workspace-relative POSIX
 * paths), filtered by `isUnderPath` against the reviewed `reviewPath`. Each is
 * read via `ctx.io.readFile` (guarded by `ctx.io.exists` + try/catch — unreadable
 * or vanished files are skipped, never thrown). The result is sorted by `fileId`
 * so downstream scans are deterministic.
 *
 * This is the harness's ONLY IO. Scanners and `runSignalScanners` are pure.
 */
export async function loadScopedSources(
    ctx: WorkspaceContext,
    importGraph: ImportGraph,
    reviewPath: string,
    pathKind: Exclude<ItemScope, 'repo'>,
): Promise<ScopedSource[]> {
    const fileIds: string[] = [];
    for (const node of importGraph.nodes.values()) {
        if (node.kind !== 'file') {
            continue;
        }
        if (isUnderPath(node.id, reviewPath, pathKind)) {
            fileIds.push(node.id);
        }
    }
    fileIds.sort((a, b) => a.localeCompare(b));

    const sources: ScopedSource[] = [];
    for (const fileId of fileIds) {
        try {
            if (!(await ctx.io.exists(fileId))) {
                continue;
            }
            const text = await ctx.io.readFile(fileId);
            sources.push({ fileId, text });
        } catch {
            // Unreadable / vanished / escaped path — skip, never throw.
            continue;
        }
    }
    return sources;
}

/**
 * Run every scanner over the loaded sources, merge results by item id, and
 * sort + dedupe each item's candidates (by `ref` then `note`). Returns a map
 * keyed by registry item id; `mergeSignals` (in `recall.ts`) folds it into the
 * checklist.
 */
export function runSignalScanners(
    sources: ScopedSource[],
    scanners: SignalScanner[],
): Map<string, RecallCandidate[]> {
    const byItem = new Map<string, RecallCandidate[]>();
    for (const scanner of scanners) {
        for (const result of scanner(sources)) {
            const list = byItem.get(result.itemId) ?? [];
            list.push(...result.candidates);
            byItem.set(result.itemId, list);
        }
    }
    for (const [itemId, list] of byItem) {
        byItem.set(itemId, sortDedupeCandidates(list));
    }
    return byItem;
}

/** Sort + dedupe candidates by `ref` then `note` (deterministic). */
export function sortDedupeCandidates(
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
