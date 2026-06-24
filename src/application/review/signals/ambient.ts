/**
 * A2 — ambient-global bypass signal (WS-4), feeding FB1 + DEP3.
 *
 * Scans each in-scope source for `window.<X>` / `globalThis.<X>` property reads
 * and emits a candidate ONLY when `<X>` is one of LLMem's INJECTED globals (the
 * host hands these to the webview at bootstrap). Platform globals not on the
 * allow-list — e.g. `window.location`, `window.addEventListener` — are NOT
 * candidates: they are normal browser API, not a host-boundary bypass.
 *
 * Feeds two registry items with the SAME candidates:
 *   - FB1 (Ambient-global bypass): the frontend framing.
 *   - DEP3 (Boundary/adapter bypass): the generic boundary-bypass framing.
 *
 * The recall is noisy by construction (it does NOT exempt the sanctioned
 * bootstrap/adapter file): the LLM filter judges which reader is the single
 * sanctioned entry vs a real bypass. Emits one candidate per
 * (file, injected-global) pair.
 *
 * Pure: text in, candidates out. No IO, no `Date`, no `Math.random`.
 */

import type { RecallCandidate } from '../types';
import type { ScopedSource, SignalResult, SignalScanner } from './source-scan';

/**
 * The host-injected globals LLMem hands the webview at bootstrap. A `window.`/
 * `globalThis.` read of any of these is an ambient-global coupling candidate.
 * (Future-optimization note: the extraction-plan's persisted-AST version would
 * derive this set from the injection site; here it is a maintained allow-list.)
 */
const INJECTED_GLOBALS: ReadonlySet<string> = new Set([
    'GRAPH_DATA',
    'WORK_TREE',
    'DESIGN_DOCS',
    'WATCHED_FILES',
    'FOLDER_TREE',
    'FOLDER_EDGES',
    'vis',
    'LLMEM_DEBUG',
]);

/** `window.<name>` / `globalThis.<name>` property reads. */
const AMBIENT_RE = /\b(?:window|globalThis)\.([A-Za-z_$][\w$]*)/g;

/**
 * Collect the distinct injected-global names read in one source, in
 * first-seen order (de-duplicated). Order does not matter for determinism —
 * `runSignalScanners` re-sorts — but per-file dedupe keeps "one candidate per
 * (file, injected-global) pair".
 */
function injectedReadsIn(text: string): string[] {
    const seen = new Set<string>();
    const names: string[] = [];
    // A fresh regex per call avoids shared `lastIndex` state across files.
    const re = new RegExp(AMBIENT_RE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const name = m[1];
        if (INJECTED_GLOBALS.has(name) && !seen.has(name)) {
            seen.add(name);
            names.push(name);
        }
    }
    return names;
}

/** Build the candidates for one source (one per injected-global read). */
function candidatesFor(source: ScopedSource): RecallCandidate[] {
    return injectedReadsIn(source.text).map(name => ({
        ref: `${source.fileId}:window.${name}`,
        note: `reads injected global window.${name}`,
    }));
}

/**
 * `ambientScanner` — emits FB1 + DEP3 results (identical candidate lists) for
 * every (in-scope file, injected-global) pair. Returns empty result lists when
 * nothing matches (the harness merge tolerates empties).
 */
export const ambientScanner: SignalScanner = (
    sources: ScopedSource[],
): SignalResult[] => {
    const candidates: RecallCandidate[] = [];
    for (const source of sources) {
        candidates.push(...candidatesFor(source));
    }
    // Same candidates feed both the frontend (FB1) and generic (DEP3) framings.
    return [
        { itemId: 'FB1', candidates: [...candidates] },
        { itemId: 'DEP3', candidates: [...candidates] },
    ];
};
