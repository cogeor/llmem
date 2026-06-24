/**
 * Public surface of the `src/application/review/` capability layer (WS-1).
 *
 * Re-exports the review-checklist DTOs and the frozen `REVIEW_REGISTRY`. This
 * loop is pure data: there is no analyzer wiring, recall logic, or rendering
 * here yet (later loops add those). Hosts (CLI / MCP / webview wiring) import
 * from this barrel.
 */

export * from './types';
export { REVIEW_REGISTRY } from './registry';
export {
    detectPathKind,
    isUnderPath,
    normalizeReviewPath,
} from './scope';
export {
    reviewRecallFromReport,
    runReviewRecall,
    ReviewRecallError,
} from './recall';
