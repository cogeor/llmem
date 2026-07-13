/**
 * Registry-driven scanner→item wiring (D3, 2026-07-13).
 *
 * Before this module every scanner hard-coded the registry item ids it fed
 * (`{ itemId: 'FB1', … }`), which made `ChecklistItem.recallQuery`
 * decorative — the string in the registry could say anything and nothing
 * would notice (ENC5's `'interface-decl'` mapped to no producer for a full
 * loop while the scanner fed it by literal).
 *
 * Now each scanner declares the QUERY KEY(S) it produces and derives its
 * target items from the registry at call time: an item receives a scanner's
 * candidates iff `item.recallQuery` is one of the scanner's keys. The
 * registry is the single wiring authority; `tests/unit/application/review/
 * registry.test.ts` asserts every non-instruction recallQuery has a live
 * producer (analyzer bucket or scanner key).
 */

import { REVIEW_REGISTRY } from '../registry';
import type { RecallCandidate } from '../types';
import type { SignalResult } from './source-scan';

/** Item ids whose registry `recallQuery` is one of `queryKeys`. */
export function itemsForQueries(queryKeys: readonly string[]): string[] {
    return REVIEW_REGISTRY.filter(i => queryKeys.includes(i.recallQuery)).map(
        i => i.id,
    );
}

/**
 * Emit one `SignalResult` per registry-wired item (identical candidate
 * lists — the per-item copy keeps downstream sorts independent).
 */
export function resultsForQueries(
    queryKeys: readonly string[],
    candidates: RecallCandidate[],
): SignalResult[] {
    return itemsForQueries(queryKeys).map(itemId => ({
        itemId,
        candidates: [...candidates],
    }));
}
