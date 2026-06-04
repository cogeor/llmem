/**
 * Hot-reload render helpers
 *
 * vscode-free data-collection + markdown-rendering helpers for the
 * `HotReloadService` in `hot-reload.ts`. Split out (Loop 21) to keep the
 * dev hot-reload wiring under the platform-handler line budget. This file
 * deliberately imports NO `vscode` symbols so it can live outside the
 * extension-only type-check surface.
 */

import { collectViewerData } from '../application/viewer-data';
import type { WorkspaceContext } from '../application/workspace-context';
import { createLogger } from '../common/logger';
import type { DesignDoc } from '../webview/design-docs';
import { renderMarkdown } from '../webview/markdown-renderer';
import type { WebviewGraphData } from '../graph/webview-data';
import type { ITreeNode } from '../application/viewer/worktree';

const log = createLogger('hot-reload');

/**
 * The rendered shape that hot-reload pushes to the panel. Identical to
 * the pre-Loop-06 `WebviewData` interface (markdown rendered to HTML),
 * preserved here so the panel-side callback contract does not change.
 */
export interface WebviewData {
    graphData: WebviewGraphData;
    workTree: ITreeNode;
    designDocs: Record<string, DesignDoc>;
}

/**
 * Collect the current viewer data for `ctx` and render its design docs to
 * the `WebviewData` shape. Pure data assembly — the caller is responsible
 * for delivering the result to the panel.
 */
export async function collectWebviewData(ctx: WorkspaceContext): Promise<WebviewData> {
    const raw = await collectViewerData(ctx);
    const designDocs = await renderRawDesignDocs(raw.designDocs);
    return {
        graphData: raw.graphData,
        workTree: raw.workTree,
        designDocs,
    };
}

/**
 * Render raw markdown into `DesignDoc` shape. Mirrors the panel-side
 * helper in `panel.ts`. Loop 19 routes both helpers through the
 * centralized `renderMarkdown` (`src/webview/markdown-renderer.ts`).
 */
export async function renderRawDesignDocs(raw: Record<string, string>): Promise<Record<string, DesignDoc>> {
    const out: Record<string, DesignDoc> = {};
    for (const [key, markdown] of Object.entries(raw)) {
        try {
            const html = await renderMarkdown(markdown);
            out[key] = { markdown, html };
        } catch (e) {
            log.error('Failed to render design doc', {
                key,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }
    return out;
}
