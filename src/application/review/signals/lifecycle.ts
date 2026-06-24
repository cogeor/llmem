/**
 * A1 — listener/subscription balance signal (WS-4), feeding FL1 + ST4.
 *
 * Scans each in-scope source for lifecycle REGISTER vs RELEASE call lexemes and
 * emits a candidate when a file's register count exceeds its release count — the
 * regex-review-time approximation of the extraction-plan's A1 lifecycle-balance
 * pass. Per-entity balance is out of regex reach (we can't reliably bound a
 * mount/teardown pair from text), so this is FILE granularity: noisy by design,
 * and the LLM filter judges the genuine leak vs the app-lifetime singleton that
 * never tears down.
 *
 *   REGISTER: addEventListener( · .subscribe( · .on( · .observe( · .connect( ·
 *             .watch(
 *   RELEASE:  removeEventListener( · .unsubscribe( · .off( · .disconnect( ·
 *             .unobserve( · .dispose( · bare unsubscribe()
 *
 * Method names are word-boundaried so `connection(` / `disconnection(` don't
 * match `connect` / `disconnect`, and each lexeme is matched by a precise,
 * distinct pattern: `addEventListener(` is matched on its own and is NOT also
 * counted by the `.on(` register pattern (whose `\.` prefix can't precede a bare
 * `addEventListener`), nor by any release pattern.
 *
 * Feeds two registry items with the SAME candidates:
 *   - FL1 (Listener/subscription leak): the frontend framing (●●○).
 *   - ST4 (Resource lifecycle): the generic acquire-without-release framing (●●○).
 *
 * Pure: text in, candidates out. No IO, no `Date`, no `Math.random`.
 */

import type { RecallCandidate } from '../types';
import type { ScopedSource, SignalResult, SignalScanner } from './source-scan';

/**
 * REGISTER lexemes. `addEventListener(` is its own pattern; the method-name
 * patterns are `\.`-prefixed and `(?![\w$])`-suffixed (after the name, before
 * the `(`) so that e.g. `connection(` does not match `connect`. A `\.` prefix on
 * `on`/`watch`/etc. also prevents a bare identifier (`watchman(`) from matching.
 */
const REGISTER_RES: readonly RegExp[] = [
    /\baddEventListener\(/g,
    /\.subscribe(?![\w$])\s*\(/g,
    /\.on(?![\w$])\s*\(/g,
    /\.observe(?![\w$])\s*\(/g,
    /\.connect(?![\w$])\s*\(/g,
    /\.watch(?![\w$])\s*\(/g,
];

/**
 * RELEASE lexemes. `removeEventListener(` is its own pattern; the method-name
 * patterns are `\.`-prefixed and word-boundaried after the name. `unsubscribe`
 * also matches as a bare disposer invocation (`unsubscribe()` with no receiver),
 * via a separate non-`.`-anchored pattern.
 */
const RELEASE_RES: readonly RegExp[] = [
    /\bremoveEventListener\(/g,
    /\.unsubscribe(?![\w$])\s*\(/g,
    /\.off(?![\w$])\s*\(/g,
    /\.disconnect(?![\w$])\s*\(/g,
    /\.unobserve(?![\w$])\s*\(/g,
    /\.dispose(?![\w$])\s*\(/g,
    /(?<![\w$.])unsubscribe(?![\w$])\s*\(/g,
];

/** Count total matches of every pattern in `res` across `text`. */
function countMatches(text: string, res: readonly RegExp[]): number {
    let total = 0;
    for (const re of res) {
        // A fresh regex per call avoids shared `lastIndex` state across files.
        const r = new RegExp(re.source, 'g');
        while (r.exec(text) !== null) {
            total++;
        }
    }
    return total;
}

/** Build the candidate for one source, or none when register ≤ release. */
function candidateFor(source: ScopedSource): RecallCandidate | undefined {
    const register = countMatches(source.text, REGISTER_RES);
    const release = countMatches(source.text, RELEASE_RES);
    if (register <= release) {
        return undefined;
    }
    return {
        ref: source.fileId,
        note: `${register} register vs ${release} release call(s) — possible leak`,
    };
}

/**
 * `listenerBalanceScanner` — emits FL1 + ST4 results (identical candidate lists)
 * for every in-scope file whose REGISTER call count exceeds its RELEASE call
 * count. Returns empty result lists when nothing is unbalanced (the harness merge
 * tolerates empties).
 */
export const listenerBalanceScanner: SignalScanner = (
    sources: ScopedSource[],
): SignalResult[] => {
    const candidates: RecallCandidate[] = [];
    for (const source of sources) {
        const candidate = candidateFor(source);
        if (candidate) {
            candidates.push(candidate);
        }
    }
    // Same candidates feed the frontend leak (FL1) and generic lifecycle (ST4).
    return [
        { itemId: 'FL1', candidates: [...candidates] },
        { itemId: 'ST4', candidates: [...candidates] },
    ];
};
