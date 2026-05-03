/**
 * MCP Tool Registry
 *
 * Aggregates per-tool definitions exported from sibling files into a single
 * `toolDefinitions` array consumed by the MCP server. Per-tool handlers and
 * Zod schemas are also re-exported so tests and external callers can keep
 * a stable import surface.
 */

import { fileInfoTool } from './file-info';
import { reportFileInfoTool } from './report-file-info';
import { folderInfoTool } from './folder-info';
import { reportFolderInfoTool } from './report-folder-info';
import { inspectSourceTool } from './inspect-source';
import { openWindowTool } from './open-window';

// Per-tool re-exports (schemas, handlers, tool definitions)
export {
    fileInfoTool,
    FileInfoSchema,
    handleFileInfo,
} from './file-info';
export type { FileInfoInput } from './file-info';

export {
    reportFileInfoTool,
    ReportFileInfoSchema,
    handleReportFileInfo,
} from './report-file-info';
export type { ReportFileInfoInput } from './report-file-info';

export {
    folderInfoTool,
    FolderInfoSchema,
    handleFolderInfo,
} from './folder-info';
export type { FolderInfoInput } from './folder-info';

export {
    reportFolderInfoTool,
    ReportFolderInfoSchema,
    handleReportFolderInfo,
} from './report-folder-info';
export type { ReportFolderInfoInput } from './report-folder-info';

export {
    inspectSourceTool,
    InspectSourceSchema,
    handleInspectSource,
    handleInspectSourceImpl,
} from './inspect-source';
export type { InspectSourceInput } from './inspect-source';

export {
    openWindowTool,
    OpenWindowSchema,
    handleOpenWindow,
} from './open-window';
export type { OpenWindowInput } from './open-window';

// The registrar — order is preserved for human-readable startup logs
// (file/report pairs first, then inspect, then open_window).
export const toolDefinitions = [
    fileInfoTool,
    reportFileInfoTool,
    folderInfoTool,
    reportFolderInfoTool,
    inspectSourceTool,
    openWindowTool,
];

// Backwards-compatible alias used by older callers
export const TOOLS = toolDefinitions;
