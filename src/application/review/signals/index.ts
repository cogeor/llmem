/**
 * Review-time signal surface (WS-4).
 *
 * `ALL_SCANNERS` is the single wiring point: each WS-4 loop appends its scanner
 * here and the `runReviewRecall` wrapper picks it up automatically. Loop 07
 * registers only the A2 ambient-global scanner; later loops push more.
 *
 * Re-exports the harness types/functions and the pure `mergeSignals` fold (which
 * lives in `recall.ts` alongside the pure recall core) so hosts and tests import
 * the whole signal surface from one barrel.
 */

import type { SignalScanner } from './source-scan';
import { ambientScanner } from './ambient';
import { domSourceScanner } from './dom-source';
import { interfaceWidthScanner } from './interface-width';
import { listenerBalanceScanner } from './lifecycle';
import { payloadOwnerScanner } from './payload-owners';

/** Every signal scanner the recall wrapper runs. Append new scanners here. */
export const ALL_SCANNERS: SignalScanner[] = [
    ambientScanner,
    domSourceScanner,
    interfaceWidthScanner,
    listenerBalanceScanner,
    payloadOwnerScanner,
];

export type {
    ScopedSource,
    SignalResult,
    SignalScanner,
} from './source-scan';
export {
    loadScopedSources,
    runSignalScanners,
    sortDedupeCandidates,
} from './source-scan';
export { ambientScanner } from './ambient';
export { domSourceScanner } from './dom-source';
export { interfaceWidthScanner } from './interface-width';
export { listenerBalanceScanner } from './lifecycle';
export { payloadOwnerScanner } from './payload-owners';
export { mergeSignals } from '../recall';
