/**
 * A4 — DOM-as-source-of-truth signal (WS-4), feeding FV1.
 *
 * Scans each in-scope source for the render-layer anti-pattern of reading model
 * facts back OUT of the DOM instead of from the model/view-model. The DOM should
 * be an OUTPUT of the model, not a source of truth that the code re-reads. The
 * matched shapes:
 *   - a `querySelector(...)` / `querySelectorAll(...)` result whose value is then
 *     read via `.textContent` / `.innerText` / `.value` / `.dataset`
 *     (e.g. `querySelector('.row').textContent`),
 *   - any `.getAttribute(` read,
 *   - any `.dataset.<x>` read.
 *
 * Candidate for FV1 = a file containing ≥1 such read. The candidate `ref` is the
 * file id; the `note` quotes the first matched snippet so the LLM filter has the
 * concrete site. Noisy by construction (a `.value` read or a `data-*` lookup is
 * sometimes legitimate input handling, not model-fact re-derivation): the LLM
 * filter judges DOM-as-source vs sanctioned read.
 *
 * Only FV1 is emitted.
 *
 * Pure: text in, candidates out. No IO, no `Date`, no `Math.random`.
 */

import type { RecallCandidate } from '../types';
import type { ScopedSource, SignalResult, SignalScanner } from './source-scan';

/**
 * DOM-read-as-source patterns, tried in order; the first match in a file becomes
 * the candidate snippet.
 *   1. `querySelector(...)`/`querySelectorAll(...)` feeding a model-fact read
 *      (`.textContent` / `.innerText` / `.value` / `.dataset`).
 *   2. `.getAttribute(` — explicit attribute read.
 *   3. `.dataset.<x>` — `data-*` read.
 * Each is global-flagged; a fresh `RegExp` is built per use to avoid shared
 * `lastIndex` state.
 */
const DOM_SOURCE_RES: readonly RegExp[] = [
    /querySelector(?:All)?\([^)]*\)[^;\n]*\.(?:textContent|innerText|value|dataset)\b/,
    /\.getAttribute\(/,
    /\.dataset\.[\w$]+/,
];

/**
 * Return the first DOM-read-as-source snippet in `text`, or `null` when the
 * source has no such read. The earliest match across all patterns (by index)
 * wins, so the quoted snippet is the first occurrence in source order.
 */
function firstDomReadIn(text: string): string | null {
    let best: { index: number; snippet: string } | null = null;
    for (const re of DOM_SOURCE_RES) {
        const m = new RegExp(re.source, re.flags).exec(text);
        if (m !== null && (best === null || m.index < best.index)) {
            best = { index: m.index, snippet: m[0] };
        }
    }
    return best === null ? null : best.snippet;
}

/**
 * `domSourceScanner` — emits one FV1 candidate per in-scope file that reads
 * model facts back out of the DOM. The candidate `ref` is the file id and the
 * `note` quotes the first matched snippet. Returns an empty FV1 result list when
 * no file reads the DOM as a source (the harness merge tolerates empties).
 */
export const domSourceScanner: SignalScanner = (
    sources: ScopedSource[],
): SignalResult[] => {
    const candidates: RecallCandidate[] = [];
    for (const source of sources) {
        const snippet = firstDomReadIn(source.text);
        if (snippet === null) {
            continue;
        }
        candidates.push({
            ref: source.fileId,
            note: `reads model facts from the DOM (${snippet})`,
        });
    }
    return [{ itemId: 'FV1', candidates }];
};
