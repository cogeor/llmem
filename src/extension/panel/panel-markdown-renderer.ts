/**
 * Panel markdown rendering (Loop 15 split).
 *
 * Carved verbatim from the former `panel.ts` monolith: the standalone
 * (non-`this`) helpers that turn a `ViewerData`'s raw markdown into the
 * legacy `DesignDoc` shape the webview expects.
 *
 * Re-exported through the `panel.ts` barrel; consumed by the panel
 * controller's handlers.
 */

import type { ViewerData } from '../../application/viewer-data';
import { createLogger } from '../../common/logger';
import type { DesignDoc } from '../../webview/design-docs';
import { renderMarkdown } from '../../webview/markdown-renderer';

const log = createLogger('panel');

/**
 * Renderer shape produced from a `ViewerData`'s raw markdown by the panel
 * before posting to the webview. The viewer expects the legacy
 * `Record<string, DesignDoc>` shape, where each value carries both the
 * markdown source and the rendered HTML.
 */
export interface ViewerDataRendered {
    graphData: ViewerData['graphData'];
    workTree: ViewerData['workTree'];
    designDocs: Record<string, DesignDoc>;
}

/**
 * Render raw markdown into the legacy `DesignDoc` shape.
 *
 * Application-layer `collectViewerData` returns raw markdown only; the
 * panel renders here so presentation stays out of the application layer.
 * (Loop 06 deliberate split.) Loop 19 routes the rendering through the
 * centralized `renderMarkdown` helper (`src/webview/markdown-renderer.ts`),
 * which owns the ESM dynamic-import of `marked` plus a server-side
 * DOMPurify pass.
 */
export async function renderViewerDocs(raw: Record<string, string>): Promise<Record<string, DesignDoc>> {
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

/** Compose a rendered viewer payload for posting to the webview. */
export async function toRenderedViewerData(data: ViewerData): Promise<ViewerDataRendered> {
    return {
        graphData: data.graphData,
        workTree: data.workTree,
        designDocs: await renderViewerDocs(data.designDocs),
    };
}
