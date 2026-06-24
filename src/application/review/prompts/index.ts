/**
 * Versioned, embedded review prompts (WS-6).
 *
 * The two human-readable skill memos
 * (`memo/architecture-review-skill-proposal-2026-06-24.md`,
 * `memo/frontend-architecture-review-skill-2026-06-24.md`) are the origin; these strings
 * are the single in-code source of truth the MCP/CLI serve. `selectPrompts` is a pure
 * deterministic switch — no Date, no Math.random — so the served prompt for a given
 * ruleset is stable and reproducible.
 *
 * The MCP/CLI loops import from `./prompts` directly; the parent review barrel
 * (`../index.ts`) is intentionally left untouched.
 */

import { GENERAL_REVIEW_PROMPT } from './general';
import { FRONTEND_REVIEW_PROMPT } from './frontend';

export { GENERAL_REVIEW_PROMPT } from './general';
export { FRONTEND_REVIEW_PROMPT } from './frontend';

/** Stable prompt-asset version. Bump when the embedded methodology changes materially. */
export const PROMPT_VERSION = 'review-prompt-v1';

/** Which checklist ruleset(s) a host wants served. */
export type ReviewRuleset = 'general' | 'frontend' | 'both';

/**
 * Prepended to whatever ruleset prompt(s) are selected: the status legend, the
 * tick-every-box discipline, and the graph-blind caution that govern how the rendered
 * checklist below is filled in.
 */
export const SHARED_HEADER = `# Review checklist — how to read it

Status legend for every box: \`issue-validated | non-issue | not-yet-checked\`.
Each box starts \`not-yet-checked\`. You MUST move it to either \`issue-validated\` (you
read the code and confirmed a real defect) or \`non-issue\` (you read the code and it is
justified). Tick EVERY box — validate, do not skim. A box left \`not-yet-checked\` means
the candidate was not looked at, which is the one outcome the process exists to prevent.

A "0 candidates" line is NOT a clean bill: it means the graph is blind there (no edge for
this item, or wiring the parser cannot see — dynamic dispatch, reflection, config-driven
composition, ambient globals, CSS/HTML the graph does not parse). When candidates are 0,
READ for it — open the scoped unit and check by hand. 0 candidates = graph blind, never a
clean bill.`;

/**
 * Returns `SHARED_HEADER` joined to the requested ruleset prompt(s): the general prompt,
 * the frontend prompt, or both (general then frontend), deterministically.
 */
export function selectPrompts(ruleset: ReviewRuleset): string {
    switch (ruleset) {
        case 'general':
            return `${SHARED_HEADER}\n\n${GENERAL_REVIEW_PROMPT}`;
        case 'frontend':
            return `${SHARED_HEADER}\n\n${FRONTEND_REVIEW_PROMPT}`;
        case 'both':
            return `${SHARED_HEADER}\n\n${GENERAL_REVIEW_PROMPT}\n\n${FRONTEND_REVIEW_PROMPT}`;
    }
}
