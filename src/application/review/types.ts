/**
 * Review capability-layer DTOs (WS-1, pure types).
 *
 * The architecture-review skill is a G→L pipeline: a checklist item names a
 * graph/AST recall query that produces *candidates*, and an LLM filters them.
 * This file declares the data shapes only — no analyzer wiring, no recall logic,
 * no rendering (those land in later loops). The `ChecklistItem` registry
 * (`registry.ts`) is the single source of truth for the item set; everything here
 * is the static model a host fills in at review time.
 *
 * Determinism note: NONE of these carry a timestamp or any nondeterministic
 * field. The registry is `Object.freeze`d and stable-ordered so the same item
 * set serializes byte-identically across runs.
 */

/** Where an item's per-candidate verdict stands. Defaults to 'not-yet-checked'. */
export type ChecklistStatus = 'not-yet-checked' | 'issue-validated' | 'non-issue';

/**
 * Recall strength glyph (how tightly the graph/instruction narrows before the
 * LLM reads): ●●● strong exact candidates, ●●○ partial/heuristic, ●○○ scoping /
 * instruction-narrowed. Verbatim from the review-skill memos.
 */
export type RecallStrength = '●●●' | '●●○' | '●○○';

/** The unit a checklist item is judged over. */
export type ItemScope = 'file' | 'folder' | 'repo';

/**
 * One review-checklist item. Pure data pulled from the review-skill memos.
 *
 * `recallQuery` names WHICH analyzer feeds the item, or 'instruction' for
 * instruction-as-recall (no graph signal yet). It is a free string union —
 * entries may name a not-yet-built analyzer; Loop 02 falls back to the
 * graph-blind sentinel for those.
 */
export interface ChecklistItem {
    readonly id: string; // 'D1', 'FB1', ...
    readonly category: string; // human group, e.g. 'Duplication & SSOT drift'
    readonly ruleset: 'general' | 'frontend';
    readonly scope: ItemScope;
    readonly recallStrength: RecallStrength;
    readonly title: string;
    readonly recallQuery: string; // analyzer key or 'instruction'
    readonly promptInstruction: string; // the "graph surfaces / LLM judges" guidance, condensed
}

/** A single recall hit attached to an item at review time. */
export interface RecallCandidate {
    readonly ref: string;
    readonly note?: string;
}

/** An item paired with its recalled candidates + the running verdict. */
export interface ChecklistEntry {
    readonly item: ChecklistItem;
    readonly candidates: readonly RecallCandidate[];
    readonly status: ChecklistStatus; // defaults 'not-yet-checked'
    readonly graphBlind: boolean; // true => "0 candidates — read for it"
}

/** The composed checklist for one reviewed unit. */
export interface ReviewChecklist {
    readonly path: string;
    readonly scope: ItemScope; // the unit scope this checklist was built for
    readonly ruleset: 'general' | 'frontend' | 'both';
    readonly entries: readonly ChecklistEntry[];
}
