/**
 * Document-folder service barrel (Loop 14 split).
 *
 * Application-layer entry point for the `folder_info` / `report_folder_info`
 * MCP workflow. The former ~582-line monolith was carved into the
 * `document-folder/` sibling directory; this file is now a THIN barrel that
 * re-exports every previously-public symbol so all existing import sites
 * (`from '../../application/document-folder'`, `from './document-folder'`)
 * keep working UNCHANGED.
 *
 * Layout of the carved units:
 *   - `document-folder/types.ts`             — public request/result/payload
 *                                              interfaces.
 *   - `document-folder/folder-projection.ts` — structural-markdown renderer +
 *                                              STDLIB_FUNCTIONS constant.
 *   - `document-folder/folder-prompt.ts`     — enrichment-prompt + README
 *                                              string renderers.
 *   - `document-folder/service.ts`           — the two public entry points.
 *
 * Module-resolution note: a sibling `document-folder.ts` FILE takes
 * precedence over the `document-folder/` DIRECTORY for
 * `import ... from './document-folder'`, so this barrel stays the single
 * authoritative entry point.
 */

// Public types — re-export verbatim.
export type {
    EnrichedFolderKeyFile,
    EnrichedFolderData,
    DocumentFolderRequest,
    DocumentFolderData,
    ReportFolderInfoRequest,
    ReportFolderInfoResult,
} from './document-folder/types';

// Public entry points.
export {
    buildDocumentFolderPrompt,
    processFolderInfoReport,
} from './document-folder/service';
