/**
 * Document-folder service entry points (Loop 14 extraction of
 * `application/document-folder.ts`).
 *
 * `buildDocumentFolderPrompt` (combined extraction + prompt building) and
 * `processFolderInfoReport` (writes the LLM-enriched README) are the two
 * application-layer entries for the `folder_info` / `report_folder_info`
 * MCP workflow.
 *
 * Boundary discipline (mirrors Loop 07):
 *   - Every entry point takes a branded `WorkspaceRoot` AND a `WorkspaceIO`
 *     constructed from it. No call into `getWorkspaceRoot()` or
 *     `process.cwd()` from inside this module.
 *   - All filesystem access goes through `workspace/workspace-io`
 *     (realpath-strong containment; L25). No direct `fs` imports.
 *   - No imports from `src/artifact/` (deprecated; Loop 17 retires it).
 *
 * The artifact directory (`ctx.artifactRoot`, holding `import-edgelist.json`
 * and `call-edgelist.json`) is read directly via the edge-list stores. The
 * folder analysis is a pure projection over those stores plus the filtering
 * helpers in `src/graph/query/filter.ts`.
 */

import * as path from 'path';
import { ImportEdgeListStore, CallEdgeListStore } from '../../graph/edgelist';
import { getEdgesForModule } from '../../graph/query/filter';
import { getFolderArchPath } from '../../docs/arch-store';
import { renderCoverageCaveat } from '../coverage-caveat';
import { refreshFolderGraph } from '../refresh-graph';
import type { WorkspaceContext } from '../workspace-context';
import type {
    DocumentFolderRequest,
    DocumentFolderData,
    ReportFolderInfoRequest,
    ReportFolderInfoResult,
} from './types';
import { renderStructuralMarkdown } from './folder-projection';
import { renderEnrichmentPrompt, renderFolderReadme } from './folder-prompt';

// ============================================================================
// buildDocumentFolderPrompt
// ============================================================================

/**
 * Read folder structural data (files, imports, calls) from the edge-list
 * stores and build the LLM prompt that drives report_folder_info.
 *
 * Replaces the legacy `getFolderInfoForMcp` + `buildFolderEnrichmentPrompt`
 * pair. Workspace root is supplied by the caller; this function does
 * not call `process.cwd()` or any deprecated artifact helper.
 */
export async function buildDocumentFolderPrompt(
    ctx: WorkspaceContext,
    req: DocumentFolderRequest,
): Promise<DocumentFolderData> {
    const { workspaceRoot, io } = ctx;
    const { folderPath, refresh } = req;

    // Confirm the folder exists. WorkspaceIO.exists returns false on
    // ENOENT/ENOTDIR but throws PathEscapeError on textual escape, so
    // path-traversal attempts surface rather than silently returning false.
    if (!(await io.exists(folderPath))) {
        throw new Error(`Folder not found: ${folderPath}`);
    }

    // LS-06: bring the subtree's edges up to date BEFORE loading the stores
    // for projection. On a cold workspace this CREATES the artifact root on
    // demand (via the scan/store save path), which is why the old "Artifacts
    // directory not found … run 'npm run scan' first" throw below is gone.
    // The returned ScanCoverage feeds the LS-04 §7 caveat. `refresh` defaults
    // to 'auto'; LS-09 plumbs an optional 'skip' through the MCP schema so
    // back-to-back same-turn calls can bypass the freshness stat-walk/diff.
    //
    // WARM path (no FS changes since last run) is stat-walk + diff only — no
    // re-parse — so repeated folder_info calls stay near-instant.
    const refreshCoverage = await refreshFolderGraph(ctx, { folderPath, refresh });

    // Load existing .arch/<folder>/README.md if present.
    const readmePath = getFolderArchPath(workspaceRoot, folderPath);
    const readmeRel = path.relative(io.getRealRoot(), readmePath).replace(/\\/g, '/');
    let existingDocs: string | null = null;
    try {
        existingDocs = await io.readFile(readmeRel);
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') throw err;
        // ENOENT → leave existingDocs null (the prompt template handles it).
    }

    // Load graphs from the configured artifact root (split stores).
    // Loop 09: this used to be a hardcoded join under the workspace
    // root because Loop 04 left the wiring incomplete; now
    // `ctx.artifactRoot` is the single source of truth and honors the
    // user's `artifactRoot` config (see `src/config-defaults.ts`).
    // LS-06: the old "Artifacts directory not found … run 'npm run scan'
    // first" throw lived here. `refreshFolderGraph` above now creates the
    // artifact root on demand (cold scan) or leaves a pre-existing one in
    // place (warm), so the throw is removed. The edge stores' own `load()`
    // tolerates a missing JSON file (returns an empty envelope), so an empty
    // subtree with no artifact root still projects cleanly.
    const artifactDir = ctx.artifactRoot;
    const importStore = new ImportEdgeListStore(artifactDir, io);
    const callStore = new CallEdgeListStore(artifactDir, io);
    await importStore.load();
    await callStore.load();

    const allImportEdges = importStore.getEdges();
    const allCallEdges = callStore.getEdges();
    const allEdges = [...allImportEdges, ...allCallEdges];
    const allNodes = [...importStore.getNodes(), ...callStore.getNodes()];

    // Filter edges for this folder (recursive to include subfolders).
    const folderEdges = getEdgesForModule(allEdges, folderPath, true);

    // Collect nodes: those involved in folder edges plus any physically
    // inside the folder (covers disconnected files).
    const involvedNodeIds = new Set<string>();
    for (const edge of folderEdges) {
        involvedNodeIds.add(edge.source);
        involvedNodeIds.add(edge.target);
    }

    const prefix = folderPath.replace(/\\/g, '/');
    const folderNodes = allNodes.filter((n) => {
        if (involvedNodeIds.has(n.id)) return true;
        const normalizedFile = n.fileId.replace(/\\/g, '/');
        return normalizedFile.startsWith(prefix.endsWith('/') ? prefix : prefix + '/');
    });

    const structuralMarkdown = renderStructuralMarkdown({
        folderPath,
        folderNodes,
        folderEdges,
        prefix,
    });

    const fileNodeCount = folderNodes.filter((n) => n.kind === 'file').length;
    const stats = {
        files: fileNodeCount,
        nodes: folderNodes.length,
        edges: folderEdges.length,
    };

    // PC-03: the heuristic-call caveat rides on the same ScanCoverage the §7
    // block uses. Honor an explicit req.coverage override, else the live
    // refresh coverage (mirrors the LS-04/LS-06 resolution below).
    const promptCoverage = req.coverage ?? refreshCoverage;

    let prompt = renderEnrichmentPrompt(
        folderPath,
        structuralMarkdown,
        folderEdges,
        stats,
        existingDocs,
        promptCoverage,
    );

    // LS-04 + LS-06: append the §7 coverage caveat when the scan that produced
    // the edge lists dropped files (denylist / size / lines).
    // `renderCoverageCaveat` returns '' when every bucket is empty, so a clean
    // coverage leaves the prompt byte-for-byte unchanged. LS-06 now wires the
    // LIVE coverage from `refreshFolderGraph` above; `req.coverage` is honored
    // as an explicit override when a caller supplies one (back-compat).
    const coverage = req.coverage ?? refreshCoverage;
    if (coverage) {
        const caveat = renderCoverageCaveat(coverage, {
            maxFileSizeKB: ctx.config.maxFileSizeKB,
            maxFileLines: ctx.config.maxFileLines,
        });
        if (caveat) prompt = `${prompt}\n${caveat}\n`;
    }

    return {
        folderPath,
        rootDir: workspaceRoot,
        readmePath,
        prompt,
        structuralMarkdown,
        existingDocs,
        rawEdges: folderEdges,
        stats,
    };
}

// ============================================================================
// processFolderInfoReport
// ============================================================================

/**
 * Persist the LLM's enrichment for a folder into .arch/{folder}/README.md.
 *
 * The branded `workspaceRoot` is the only source of truth for the
 * destination — `process.cwd()` is never consulted. This is the
 * regression fix for the README "Known Issue" workaround that the
 * legacy folder prompt told the agent to apply manually.
 */
export async function processFolderInfoReport(
    ctx: WorkspaceContext,
    req: ReportFolderInfoRequest,
): Promise<ReportFolderInfoResult> {
    const { workspaceRoot, io } = ctx;
    const { folderPath, overview, inputs, outputs, keyFiles, architecture } = req;

    const designDocument = renderFolderReadme({
        folderPath,
        overview,
        inputs,
        outputs,
        keyFiles,
        architecture,
    });

    const readmePath = getFolderArchPath(workspaceRoot, folderPath);

    // Compute the workspace-relative path against the realpath of the
    // workspace root. WorkspaceIO.writeFile does NOT auto-mkdir, so we
    // explicitly mkdir-recursive the parent first.
    const readmeRel = path.relative(io.getRealRoot(), readmePath).replace(/\\/g, '/');
    await io.mkdirRecursive(path.dirname(readmeRel));
    await io.writeFile(readmeRel, designDocument);

    return {
        readmePath,
        bytesWritten: Buffer.byteLength(designDocument, 'utf-8'),
        designDocument,
    };
}
