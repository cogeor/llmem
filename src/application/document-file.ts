/**
 * Document-file service barrel (Loop 12 split).
 *
 * Application-layer entry point for the `file_info` / `report_file_info`
 * MCP workflow. The former ~507-line monolith was carved into the
 * `document-file/` sibling directory; this file is now a THIN barrel that
 * re-exports every previously-public symbol so all existing import sites
 * (`from '../../application/document-file'`, `from './document-file'`)
 * keep working UNCHANGED.
 *
 * Layout of the carved units:
 *   - `document-file/types.ts`           — public request/result/payload
 *                                          interfaces.
 *   - `document-file/file-projection.ts` — structural-markdown renderer +
 *                                          STDLIB_FUNCTIONS constant.
 *   - `document-file/file-prompt.ts`     — enrichment-prompt + design-document
 *                                          renderers.
 *   - `document-file/service.ts`         — the two public entry points.
 *
 * Module-resolution note: a sibling `document-file.ts` FILE takes
 * precedence over the `document-file/` DIRECTORY for
 * `import ... from './document-file'`, so this barrel stays the single
 * authoritative entry point.
 */

// Public types — re-export verbatim.
export type {
    EnrichedFunction,
    EnrichedFileData,
    DocumentFileRequest,
    DocumentFileData,
    ReportFileInfoRequest,
    ReportFileInfoResult,
} from './document-file/types';

// Public entry points.
export {
    buildDocumentFilePrompt,
    processFileInfoReport,
} from './document-file/service';
