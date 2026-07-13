/**
 * Public surface of the `src/application/analysis/` capability layer.
 *
 * Re-exports the DTOs, the import-cycle analyzer, the health-scan composer, the
 * deterministic markdown renderer, and the analysis-cache stub. Hosts (CLI / MCP
 * / webview wiring — later loops) import from here.
 */

export * from './types';
export { findImportCycles, importCyclesFromGraph } from './cycles';
export {
    hubMetricsFromGraph,
    computeHubReport,
    maxFanInFromGraph,
    HUB_DEGREE_THRESHOLD,
    KERNEL_INSTABILITY_MAX,
} from './metrics';
export {
    computeInterfaceWidth,
    interfaceWidthFromGraph,
    calibrateInterfaceWidthSeverity,
} from './interface-width';
export { runHealthScan, reportHasFindingKind } from './health';
export { loadGraphs } from './load-graphs';
export type { LoadedGraphs } from './load-graphs';
export type { HealthScanOptions } from './health';
export { renderHealthReport } from './report-markdown';
export { findClones, clusterClones, CLONE_MIN_TOKENS } from './clones';
export type { EntityHash } from './clones';
export { normalizeBody, sha256Hex } from './clones-normalize';
export type { NormalizedBody } from './clones-normalize';
export { loadAnalysisCache, saveAnalysisCache } from './cache';
export type { AnalysisCache, CachedFile, CachedEntity } from './cache';
export { buildHealthOverlay } from './webview-overlay';
