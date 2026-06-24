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
    computeHubMetrics,
    hubMetricsFromGraph,
    computeHubReport,
    maxFanInFromGraph,
    HUB_DEGREE_THRESHOLD,
    KERNEL_INSTABILITY_MAX,
} from './metrics';
export { runHealthScan } from './health';
export type { HealthScanOptions } from './health';
export { renderHealthReport } from './report-markdown';
export { loadAnalysisCache, saveAnalysisCache } from './cache';
export type { AnalysisCache } from './cache';
