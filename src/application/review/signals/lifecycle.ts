/**
 * A1 — listener/subscription balance signal (WS-4), feeding FL1 + ST4.
 *
 * Scans each in-scope source for lifecycle REGISTER vs RELEASE call lexemes and
 * emits a candidate when an entity's register count exceeds its release count —
 * the regex-review-time approximation of the extraction-plan's A1
 * lifecycle-balance pass. Loop 04 moves the tally from FILE granularity to
 * PER-ENTITY: each match is attributed (via the pure `entitySpans` brace tracker)
 * to its enclosing class/method, so a leak names `<fileId>::<Class.method>` and
 * a module-top-level leak falls back to the plain `<fileId>`. Still noisy by
 * design — the LLM filter judges the genuine leak vs the app-lifetime singleton
 * that never tears down.
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

import { makeEntityId } from '../../../core/ids';
import type { RecallCandidate } from '../types';
import { entitySpans, enclosingEntity } from './entity-spans';
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

/** Per-entity register/release tallies, keyed by enclosing entity name. */
interface Tally {
    register: number;
    release: number;
}

// The file-level bucket key for matches that sit outside every declaration.
// A symbol can't key a Map insertion-order test cleanly, so we use `null`.
type BucketKey = string | null;

/**
 * Accumulate matches of every pattern in `res` into `buckets`, attributing each
 * match to its enclosing entity (or the `null` file-level bucket). `kind` selects
 * which side of the tally to bump.
 */
function tallyMatches(
    text: string,
    spans: ReturnType<typeof entitySpans>,
    res: readonly RegExp[],
    kind: 'register' | 'release',
    buckets: Map<BucketKey, Tally>,
): void {
    for (const re of res) {
        // A fresh regex per call avoids shared `lastIndex` state across files.
        const r = new RegExp(re.source, 'g');
        let m: RegExpExecArray | null;
        while ((m = r.exec(text)) !== null) {
            const key: BucketKey = enclosingEntity(spans, m.index) ?? null;
            const tally = buckets.get(key) ?? { register: 0, release: 0 };
            tally[kind]++;
            buckets.set(key, tally);
        }
    }
}

/**
 * Build the per-entity leak candidates for one source. Each entity (or the
 * file-level fallback bucket) whose register count exceeds its release count
 * yields one candidate; the harness sorts/dedupes the merged list.
 */
function candidatesFor(source: ScopedSource): RecallCandidate[] {
    const spans = entitySpans(source.text);
    const buckets = new Map<BucketKey, Tally>();
    tallyMatches(source.text, spans, REGISTER_RES, 'register', buckets);
    tallyMatches(source.text, spans, RELEASE_RES, 'release', buckets);

    const out: RecallCandidate[] = [];
    for (const [key, { register, release }] of buckets) {
        if (register <= release) {
            continue;
        }
        const ref =
            key === null ? source.fileId : makeEntityId(source.fileId, key);
        out.push({
            ref,
            note: `${register} register vs ${release} release call(s) — possible leak`,
        });
    }
    return out;
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
        candidates.push(...candidatesFor(source));
    }
    // Same candidates feed the frontend leak (FL1) and generic lifecycle (ST4).
    return [
        { itemId: 'FL1', candidates: [...candidates] },
        { itemId: 'ST4', candidates: [...candidates] },
    ];
};
