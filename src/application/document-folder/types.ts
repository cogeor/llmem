/**
 * Public types for the document-folder workflow (Loop 14 extraction of
 * `application/document-folder.ts`). Re-exported verbatim by the barrel so
 * all existing import sites keep resolving these names unchanged.
 */

import type { WorkspaceRoot, AbsPath, RelPath } from '../../core/paths';
import type { EdgeEntry } from '../../graph/edgelist';
import type { ScanCoverage } from '../scan';

/**
 * One key file entry in the LLM enrichment payload.
 */
export interface EnrichedFolderKeyFile {
    name: string;
    summary: string;
}

/**
 * LLM enrichment payload for a folder.
 */
export interface EnrichedFolderData {
    path: string;
    overview: string;
    inputs?: string;
    outputs?: string;
    key_files: EnrichedFolderKeyFile[];
    architecture: string;
}

/** Per-call request fields for `buildDocumentFolderPrompt`. */
export interface DocumentFolderRequest {
    folderPath: RelPath;
    /**
     * `'auto'` (default): refresh the subtree's edges before building the
     * prompt (warm = stat-walk + diff only; cold/changed = filtered rescan).
     * `'skip'`: project the current stores as-is, no freshness work. Mirrors
     * the file path's `refresh`; LS-09 plumbs it through the MCP schema.
     */
    refresh?: 'auto' | 'skip';
    /**
     * Optional filter-coverage from the scan that produced the edge lists.
     * When present and non-empty, a §7 "COVERAGE NOTES" caveat block is
     * appended to the prompt (see {@link renderCoverageCaveat}). Optional so
     * this loop (LS-04) is independently shippable — the full live wiring of
     * a fresh scan's coverage lands in LS-06. Absent/empty → no caveat,
     * prompt unchanged.
     */
    coverage?: ScanCoverage;
}

export interface DocumentFolderData {
    /** Folder-relative path (forward slashes). */
    folderPath: RelPath;
    /** Workspace root used for all path resolution. */
    rootDir: WorkspaceRoot;
    /** Absolute path to the .arch/{folder}/README.md target. */
    readmePath: AbsPath;
    /** Prompt for the host LLM (full folder-overview generation prompt). */
    prompt: string;
    /** Auto-extracted structural summary (files, imports, calls). */
    structuralMarkdown: string;
    /** Existing .arch README contents, if any. */
    existingDocs: string | null;
    /** Raw edges relevant to the folder (for diagnostics / future use). */
    rawEdges: EdgeEntry[];
    stats: {
        files: number;
        nodes: number;
        edges: number;
    };
}

/** Per-call request fields for `processFolderInfoReport`. */
export interface ReportFolderInfoRequest {
    folderPath: RelPath;
    overview: string;
    inputs?: string;
    outputs?: string;
    keyFiles: EnrichedFolderKeyFile[];
    architecture: string;
}

export interface ReportFolderInfoResult {
    readmePath: AbsPath;
    bytesWritten: number;
    designDocument: string;
}
