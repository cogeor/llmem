/**
 * Public types for the document-file workflow (Loop 12 extraction of
 * `application/document-file.ts`). Re-exported verbatim by the barrel so
 * all existing import sites keep resolving these names unchanged.
 */

import type { WorkspaceRoot, AbsPath, RelPath } from '../../core/paths';
import type { FileInfo } from '../file-info';

/**
 * Enriched function data from the LLM.
 */
export interface EnrichedFunction {
    name: string;
    purpose: string;
    implementation: string;
}

/**
 * LLM enrichment payload for a single file.
 */
export interface EnrichedFileData {
    path: string;
    overview: string;
    inputs?: string;
    outputs?: string;
    functions: EnrichedFunction[];
}

/** Per-call request fields for `buildDocumentFilePrompt`. */
export interface DocumentFileRequest {
    filePath: RelPath;
    /**
     * `'auto'` (default): refresh THIS file's edges before building the prompt
     * (warm = stat + manifest compare only; cold/changed = re-gate + parse).
     * `'skip'`: project the current stores as-is, no freshness work. Mirrors
     * the folder path's `refresh`; LS-09 plumbs it through the MCP schema.
     */
    refresh?: 'auto' | 'skip';
}

export interface DocumentFileData {
    /** Source-relative path (forward slashes). */
    filePath: RelPath;
    /** Workspace root used for all path resolution. */
    rootDir: WorkspaceRoot;
    /** Absolute path to the .llmem/docs/{path}.md target. */
    docPath: AbsPath;
    /** Prompt for the host LLM (full design-doc generation prompt). */
    prompt: string;
    /** Auto-extracted structural summary (imports, entities, call edges). */
    structuralMarkdown: string;
    /** FileInfo (functions, classes) for downstream rendering. */
    info: FileInfo;
    /** Source code that was read. */
    sourceCode: string;
}

/** Per-call request fields for `processFileInfoReport`. */
export interface ReportFileInfoRequest {
    filePath: RelPath;
    overview: string;
    inputs?: string;
    outputs?: string;
    functions: EnrichedFunction[];
}

export interface ReportFileInfoResult {
    docPath: AbsPath;
    bytesWritten: number;
    designDocument: string;
}
