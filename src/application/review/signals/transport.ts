/**
 * B1 — transport-boundary typing signal (WS-4), feeding FP1.
 *
 * Scans each in-scope source for message/event SINKS — the points where a
 * serialized payload crosses a transport boundary and re-enters code as data:
 *   - `onDidReceiveMessage(` (VS Code webview/host messaging),
 *   - `addEventListener('message'` / `addEventListener("message"` (DOM/Worker),
 *   - `.onmessage` (WebSocket / Worker / MessagePort handler property),
 *   - `postMessage(` (the send/handler-registration counterpart).
 *
 * A file that contains ≥1 such sink is the candidate site. Two typing flags
 * sharpen the note (recall stays noisy by design — a sink alone is enough):
 *   - `payloadUntyped` — the file annotates a handler-ish param as `: any` or
 *     `: unknown` (the payload is not modeled as a real type), and
 *   - `validatesBeforeUse` — the file calls a validator/codec
 *     (`parse(` / `validate(` / `decode(` / `isValid(` / `safeParse(`), i.e.
 *     it runs a runtime check on the wire data somewhere.
 * The LLM filter judges "serialized transport needs a runtime codec" against the
 * concrete site; this scanner only surfaces the boundary.
 *
 * Candidate for FP1 = a file with a transport sink. Loop 04 attributes the
 * candidate to the entity enclosing the file's FIRST sink (via the pure
 * `entitySpans` brace tracker): `ref = <fileId>::<Class.method>`, falling back to
 * the plain `<fileId>` when the first sink sits outside any declaration. The
 * `note` (`transport sink; payloadUntyped=<bool> validatesBeforeUse=<bool>`) and
 * the one-candidate-per-sink-file cardinality are unchanged — the two typing
 * flags remain file-scoped presence flags by design.
 *
 * Only FP1 is emitted.
 *
 * Pure: text in, candidates out. No IO, no `Date`, no `Math.random`.
 */

import { makeEntityId } from '../../../core/ids';
import type { RecallCandidate } from '../types';
import { entitySpans, enclosingEntity } from './entity-spans';
import type { ScopedSource, SignalResult, SignalScanner } from './source-scan';
import { resultsForQueries } from './wiring';

/**
 * Transport-sink patterns. A file matching any of these crosses a serialization
 * boundary and is surfaced for FP1. Each is reused via a fresh `RegExp` to avoid
 * shared `lastIndex` state.
 */
const SINK_RES: readonly RegExp[] = [
    /onDidReceiveMessage\s*\(/,
    /addEventListener\s*\(\s*['"]message['"]/,
    /\.onmessage\b/,
    /postMessage\s*\(/,
];

/**
 * Untyped-payload patterns: a handler-ish param (or any annotation) typed as
 * `any` / `unknown`. Presence anywhere in a sink-bearing file flags the payload
 * as unmodeled.
 */
const UNTYPED_RE = /:\s*(?:any|unknown)\b/;

/**
 * Validator/codec patterns: a runtime check on the wire data. Presence anywhere
 * in a sink-bearing file flags `validatesBeforeUse=true`.
 */
const VALIDATOR_RE = /\b(?:parse|validate|decode|isValid|safeParse)\s*\(/;

/**
 * Offset of the FIRST transport sink in `text`, or `-1` when none. We take the
 * minimum `match.index` across every sink pattern so the candidate is attributed
 * to the entity that owns the earliest sink.
 */
function firstSinkOffset(text: string): number {
    let min = Infinity;
    for (const re of SINK_RES) {
        const r = new RegExp(re.source, 'g');
        const m = r.exec(text);
        if (m && m.index < min) {
            min = m.index;
        }
    }
    return min === Infinity ? -1 : min;
}

/**
 * `transportScanner` — emits one FP1 candidate per in-scope file containing a
 * message/event transport sink. The candidate `ref` is the file id and the
 * `note` records the two typing flags. Returns an empty FP1 result list when no
 * file crosses a transport boundary (the harness merge tolerates empties).
 */
export const TRANSPORT_QUERY_KEYS = ['transport'] as const;

export const transportScanner: SignalScanner = (
    sources: ScopedSource[],
): SignalResult[] => {
    const candidates: RecallCandidate[] = [];
    for (const source of sources) {
        const sinkOffset = firstSinkOffset(source.text);
        if (sinkOffset < 0) {
            continue;
        }
        const payloadUntyped = UNTYPED_RE.test(source.text);
        const validatesBeforeUse = VALIDATOR_RE.test(source.text);
        const key = enclosingEntity(entitySpans(source.text), sinkOffset);
        const ref = key
            ? makeEntityId(source.fileId, key)
            : source.fileId;
        candidates.push({
            ref,
            note: `transport sink; payloadUntyped=${payloadUntyped} validatesBeforeUse=${validatesBeforeUse}`,
        });
    }
    // D3: target from the registry (recallQuery 'transport').
    return resultsForQueries(TRANSPORT_QUERY_KEYS, candidates);
};
