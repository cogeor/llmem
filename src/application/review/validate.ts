/**
 * Review-checklist completeness validator (WS-5, pure).
 *
 * The two-phase MCP `review` / `report_review` flow exists to enforce ONE
 * guarantee: every required checklist box is resolved before a review is
 * persisted. This module is that gate, expressed as a pure function over the
 * submitted items and the selected ruleset.
 *
 * Required set = `REVIEW_REGISTRY` filtered by ruleset ('both' ⇒ all items). An
 * id is RESOLVED iff it is submitted with status `'issue-validated'` or
 * `'non-issue'`. Anything missing, or submitted as `'not-yet-checked'`, is
 * UNRESOLVED. The completeness verdict is `unresolved.length === 0`.
 *
 * Determinism: `unresolved` is returned in `REVIEW_REGISTRY` order (NOT input
 * order, NOT alphabetical) so the rejection message is byte-stable across runs.
 * No `Date`, no `Math.random`.
 */

import type { ChecklistStatus } from './types';
import { REVIEW_REGISTRY } from './registry';

/** One reported per-item verdict submitted to `report_review`. */
export interface SubmittedItem {
    readonly id: string;
    readonly status: ChecklistStatus;
    readonly note?: string;
}

/** The completeness verdict: complete iff `unresolved` is empty. */
export interface CompletenessResult {
    readonly complete: boolean;
    /** Required ids still missing or `'not-yet-checked'`, in registry order. */
    readonly unresolved: string[];
}

/** Statuses that count as a resolved (looked-at) box. */
const RESOLVED_STATUSES: ReadonlySet<ChecklistStatus> = new Set([
    'issue-validated',
    'non-issue',
]);

/**
 * Check whether `submitted` resolves every required item for `ruleset`.
 *
 * @param submitted - the reported per-item verdicts (any order; extras ignored)
 * @param ruleset - which item set is required ('both' ⇒ all)
 * @returns `{ complete, unresolved }` with `unresolved` in registry order
 */
export function validateCompleteness(
    submitted: readonly SubmittedItem[],
    ruleset: 'general' | 'frontend' | 'both',
): CompletenessResult {
    // Last write wins if an id is submitted twice (deterministic over input).
    const byId = new Map<string, ChecklistStatus>();
    for (const item of submitted) {
        byId.set(item.id, item.status);
    }

    const unresolved: string[] = [];
    for (const item of REVIEW_REGISTRY) {
        if (ruleset !== 'both' && item.ruleset !== ruleset) {
            continue;
        }
        const status = byId.get(item.id);
        if (status === undefined || !RESOLVED_STATUSES.has(status)) {
            unresolved.push(item.id);
        }
    }

    return { complete: unresolved.length === 0, unresolved };
}
