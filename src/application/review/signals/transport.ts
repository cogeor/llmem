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
 * Candidate for FP1 = a file with a transport sink. The candidate `ref` is the
 * file id; the `note` is `transport sink; payloadUntyped=<bool> validatesBeforeUse=<bool>`.
 *
 * Only FP1 is emitted.
 *
 * Pure: text in, candidates out. No IO, no `Date`, no `Math.random`.
 */

import type { RecallCandidate } from '../types';
import type { ScopedSource, SignalResult, SignalScanner } from './source-scan';

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

/** Does `text` contain at least one transport sink? */
function hasTransportSink(text: string): boolean {
    return SINK_RES.some(re => new RegExp(re.source, re.flags).test(text));
}

/**
 * `transportScanner` — emits one FP1 candidate per in-scope file containing a
 * message/event transport sink. The candidate `ref` is the file id and the
 * `note` records the two typing flags. Returns an empty FP1 result list when no
 * file crosses a transport boundary (the harness merge tolerates empties).
 */
export const transportScanner: SignalScanner = (
    sources: ScopedSource[],
): SignalResult[] => {
    const candidates: RecallCandidate[] = [];
    for (const source of sources) {
        if (!hasTransportSink(source.text)) {
            continue;
        }
        const payloadUntyped = UNTYPED_RE.test(source.text);
        const validatesBeforeUse = VALIDATOR_RE.test(source.text);
        candidates.push({
            ref: source.fileId,
            note: `transport sink; payloadUntyped=${payloadUntyped} validatesBeforeUse=${validatesBeforeUse}`,
        });
    }
    return [{ itemId: 'FP1', candidates }];
};
