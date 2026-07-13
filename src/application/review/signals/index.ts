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
import { routeLiteralScanner } from './routes';
import { transportScanner } from './transport';

/** Every signal scanner the recall wrapper runs. Append new scanners here. */
export const ALL_SCANNERS: SignalScanner[] = [
    ambientScanner,
    domSourceScanner,
    interfaceWidthScanner,
    listenerBalanceScanner,
    payloadOwnerScanner,
    routeLiteralScanner,
    transportScanner,
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
export { ambientScanner, AMBIENT_QUERY_KEYS } from './ambient';
export { domSourceScanner, DOM_SOURCE_QUERY_KEYS } from './dom-source';
export { interfaceWidthScanner, INTERFACE_DECL_QUERY_KEYS } from './interface-width';
export { listenerBalanceScanner, LIFECYCLE_QUERY_KEYS } from './lifecycle';
export { payloadOwnerScanner, PAYLOAD_OWNERS_QUERY_KEYS } from './payload-owners';
export { routeLiteralScanner, ROUTES_QUERY_KEYS } from './routes';
export { transportScanner, TRANSPORT_QUERY_KEYS } from './transport';
export { mergeSignals } from '../recall';
export type { EntitySpan } from './entity-spans';
export { entitySpans, enclosingEntity } from './entity-spans';
export { itemsForQueries, resultsForQueries } from './wiring';
