/**
 * MCP Tool Registry
 *
 * Aggregates per-tool definitions exported from sibling files into a single
 * `toolDefinitions` array consumed by the MCP server. Per-tool handlers and
 * Zod schemas are also re-exported so tests and external callers can keep
 * a stable import surface.
 *
 * C5 (2026-07-13): `file_info`/`folder_info` merged into `document` and
 * `report_file_info`/`report_folder_info` into `report_document` (clean
 * break — 5 tools, no aliases; a doubled tool list is the cost the merge
 * exists to cut).
 */

import { documentTool } from './document';
import { reportDocumentTool } from './report-document';
import { reviewTool } from './review';
import { reportReviewTool } from './report-review';
import { openWindowTool } from './open-window';

// Per-tool re-exports (schemas, handlers, tool definitions)
export {
    documentTool,
    DocumentSchema,
    handleDocument,
} from './document';
export type { DocumentInput } from './document';

export {
    reportDocumentTool,
    ReportDocumentSchema,
    handleReportDocument,
} from './report-document';
export type { ReportDocumentInput } from './report-document';

export {
    reviewTool,
    ReviewSchema,
    handleReview,
} from './review';
export type { ReviewInput } from './review';

export {
    reportReviewTool,
    ReportReviewSchema,
    handleReportReview,
} from './report-review';
export type { ReportReviewInput } from './report-review';

export {
    openWindowTool,
    OpenWindowSchema,
    handleOpenWindow,
} from './open-window';
export type { OpenWindowInput } from './open-window';

// The registrar — order is preserved for human-readable startup logs
// (document/report pair first, then review pair, then open_window).
export const toolDefinitions = [
    documentTool,
    reportDocumentTool,
    reviewTool,
    reportReviewTool,
    openWindowTool,
];

// Backwards-compatible alias used by older callers
export const TOOLS = toolDefinitions;
