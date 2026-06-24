/**
 * Deterministic markdown renderer for a `ReviewChecklist` (WS-3).
 *
 * Emits a fixed-order, fixed-wording checklist: a header (path, scope, ruleset,
 * item count), a status legend, then one `## <category>` heading per distinct
 * category — in first-seen (registry) order — and under each its entries. EVERY
 * entry is emitted (the no-skip device): no item is ever dropped, and a
 * zero-candidate / graph-blind entry renders the explicit "read for it" sentinel
 * rather than a clean bill.
 *
 * Mirrors `src/application/analysis/report-markdown.ts` exactly: build a
 * `const lines: string[]`, `push`, `return lines.join('\n')`. Iterate
 * `checklist.entries` in their given (already registry-ordered) order only; each
 * entry's candidates come pre-sorted from the recall pass — do NOT re-sort.
 *
 * Determinism rules: NEVER calls `Date`/`Date.now`/`new Date()`/`Math.random`;
 * no trailing generation note / timestamp. Same `ReviewChecklist` in →
 * byte-identical string out.
 */

import type { ReviewChecklist } from './types';

/** The literal human-facing default verdict for an unchecked box. */
const STATUS_NOT_YET_CHECKED = 'NOT YET CHECKED';

/** The sentinel line for a graph-blind / zero-candidate entry. */
const GRAPH_BLIND_LINE = '      0 candidates — graph blind here, read for it';

/** Builds the deterministic cap line from a precomputed count (M = total - shown). */
const capLine = (total: number, shown: number): string =>
    `        … +${total - shown} more (capped)`;

/** Render a `ReviewChecklist` as deterministic, timestamp-free markdown. */
export function renderReviewChecklist(checklist: ReviewChecklist): string {
    const lines: string[] = [];

    lines.push(`# LLMem Architecture Review Checklist — ${checklist.path}`);
    lines.push(
        `scope: ${checklist.scope}   ruleset: ${checklist.ruleset}   items: ${checklist.entries.length}`,
    );
    // `graphSnapshot` is a passed-in PREFORMATTED ISO string (sourced once on the
    // IO side from the import-edgelist's `timestamp`), NOT a computed timestamp —
    // the renderer stays Date-free. Omitted entirely when absent so snapshot-less
    // output is byte-identical to before.
    if (checklist.graphSnapshot) {
        lines.push(`graph snapshot: ${checklist.graphSnapshot}`);
    }
    lines.push('');
    lines.push(
        'Status legend: tick EVERY box — issue-validated | non-issue | not-yet-checked.',
    );
    lines.push(
        'A "0 candidates — graph blind here, read for it" line is NOT a clean bill; open the',
    );
    lines.push('unit and read for the item before you tick it.');

    // One `## <category>` heading per distinct category, printed once before its
    // first entry, in first-seen (registry) order. EVERY entry is emitted.
    let lastCategory: string | null = null;
    for (const entry of checklist.entries) {
        const { item, candidates, graphBlind, capped } = entry;

        if (item.category !== lastCategory) {
            lines.push('');
            lines.push(`## ${item.category}`);
            lastCategory = item.category;
        }

        lines.push(
            `- [ ] ${item.id} — ${item.title}  (recall ${item.recallStrength})  status: ${STATUS_NOT_YET_CHECKED}`,
        );
        lines.push(`      ${item.promptInstruction}`);

        if (graphBlind || candidates.length === 0) {
            lines.push(GRAPH_BLIND_LINE);
        } else {
            lines.push('      candidates:');
            for (const candidate of candidates) {
                const note = candidate.note ? ` — ${candidate.note}` : '';
                lines.push(`        - ${candidate.ref}${note}`);
            }
            if (capped) {
                lines.push(capLine(capped.total, capped.shown));
            }
        }
    }

    return lines.join('\n');
}
