/**
 * Review recall gate + cap primitives (P0 — pure, IO-free).
 *
 * Split out of `recall.ts` so the recall core stays under its layer budget. ALL
 * helpers here are pure (no `Date`, no `Math.random`, no IO): the FI1 / D1 gate
 * predicates that drop low-signal analyzer findings before they become
 * candidates, the deterministic top-N `capCandidates` primitive, and the small
 * tuning constants. The gate is keyed on registry `item.id` (FI1, D1) by the
 * caller, NEVER on the shared `interface-width` recallQuery bucket — so ENC3
 * (which also reads `interface-width`) keeps its full ungated candidate list.
 */

import { parseGraphId } from '../../core/ids';
import type { CloneFinding, InterfaceWidthFinding } from '../analysis/types';
import type { RecallCandidate } from './types';

/** Max candidate lines shown per gated analyzer item before the cap line. Single tuning knob. */
export const REVIEW_CANDIDATE_CAP = 15;

/** Min cluster size for a D1 clone candidate to survive the gate. */
export const CLONE_MIN_MEMBERS = 3;

/** The registry ids whose candidate lists are gated + capped (FI1 width, D1 clones). */
export const CAPPED_ITEM_IDS: ReadonlySet<string> = new Set(['FI1', 'D1']);

/**
 * Strip an entity-id `::name` suffix to recover the owning FILE id. Entity ids
 * follow the `<fileId>::<name>` convention; file ids, folder prefixes, and bare
 * external module specifiers have no `::` and pass through unchanged. Parsing is
 * delegated to the `src/core/ids` contract module (the single owner of the
 * `::` separator) rather than re-deriving the split locally.
 */
export function toFileId(id: string): string {
    const parsed = parseGraphId(id);
    return parsed.kind === 'entity' ? parsed.fileId : id;
}

/**
 * FI1 gate: keep an interface-width finding iff it is a genuine wide-surface
 * smell, not a low-signal module measurement. Keep when severity is
 * 'high' | 'medium' (the loop-04 shallow-wide / wide-decl band) — drop the
 * 'low' placeholder findings that dominate the 203-count flood.
 */
export function keepWidthFinding(f: InterfaceWidthFinding): boolean {
    return f.severity === 'high' || f.severity === 'medium';
}

/**
 * D1 gate: keep a clone cluster iff it has >= CLONE_MIN_MEMBERS members OR it
 * spans >1 distinct file (members map to >1 fileId via toFileId). Drops the
 * 2-member single-file near-noise that dominates the 182-count flood while
 * keeping every cross-file duplication (the SSOT-drift signal D1 exists for).
 */
export function keepCloneFinding(f: CloneFinding): boolean {
    if (f.members.length >= CLONE_MIN_MEMBERS) {
        return true;
    }
    const files = new Set(f.members.map(toFileId));
    return files.size > 1;
}

/**
 * Cap an already-sorted+deduped candidate list to the top-N most salient
 * (the list is pre-sorted by ref then note, so "top-N" is deterministic).
 * Returns the (possibly trimmed) list and, when trimming occurred, the cap
 * metadata for the entry. PURE: no Date/Math.random/IO.
 */
export function capCandidates(
    candidates: RecallCandidate[],
    cap: number,
): { candidates: RecallCandidate[]; capped?: { shown: number; total: number } } {
    if (candidates.length <= cap) {
        return { candidates };
    }
    return {
        candidates: candidates.slice(0, cap),
        capped: { shown: cap, total: candidates.length },
    };
}
