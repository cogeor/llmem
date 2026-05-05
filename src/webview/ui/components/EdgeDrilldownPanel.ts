/**
 * EdgeDrilldownPanel — bottom drill-down panel for folder→folder arcs
 * (Loop 15 split).
 *
 * Owns `.package-bottom-panel`. Given a clicked `FolderEdge`, filters
 * `window.GRAPH_DATA.{import,call}Graph.edges` by `folderOf(from/to)` and
 * renders one row per matching file edge. Each row links back to the
 * 'graph' route scoped to the source-file endpoint via
 * `props.onFileEdgeNavigate(filePath)`.
 *
 * Pinned by `tests/unit/web-viewer/package-view-arc-click.test.ts` and
 * `tests/unit/web-viewer/package-view-edges.test.ts`.
 */

import type { FolderEdge } from '../../../contracts/folder-edges';
import { escape } from '../utils/escape';
import { WebviewLogger, createWebviewLogger } from '../services/webview-logger';
import { folderOf } from './folderViewModel';

export interface EdgeDrilldownPanelProps {
    /** `<div class="package-bottom-panel">` mount point. */
    el: HTMLElement;
    /** Fired when the user clicks a file-edge row's source-link. */
    onFileEdgeNavigate: (filePath: string) => void;
    logger?: WebviewLogger;
}

export class EdgeDrilldownPanel {
    private readonly props: EdgeDrilldownPanelProps;
    private readonly logger: WebviewLogger;

    constructor(props: EdgeDrilldownPanelProps) {
        this.props = props;
        this.logger = props.logger ?? createWebviewLogger({ enabled: false });
    }

    /**
     * Render the drill-down panel listing the underlying file edges that
     * roll up into the clicked folder arc. Filters
     * `window.GRAPH_DATA.{import,call}Graph.edges` by
     * `folderOf(from/to) === folderEdge.from / .to`.
     */
    show(folderEdge: FolderEdge): void {
        const graphData = window.GRAPH_DATA;
        if (graphData === undefined) {
            // safe: structural template; controlled message string.
            this.props.el.innerHTML =
                '<div class="package-edge-empty">window.GRAPH_DATA not available</div>';
            this.props.el.style.display = 'block';
            return;
        }

        const sourceList =
            folderEdge.kind === 'import'
                ? graphData.importGraph.edges
                : graphData.callGraph.edges;

        const fileEdges = sourceList.filter(
            (e) =>
                folderOf(e.from) === folderEdge.from &&
                folderOf(e.to) === folderEdge.to,
        );

        const safeFrom = escape(folderEdge.from);
        const safeTo = escape(folderEdge.to);
        const safeKind = escape(folderEdge.kind);
        const headerHtml = `
            <div class="package-edge-header">
                <strong>${safeKind}</strong>: ${safeFrom} → ${safeTo}
                (${fileEdges.length} file edges)
                <button class="package-edge-close" type="button">×</button>
            </div>
        `;

        const rowsHtml = fileEdges
            .map((e) => {
                const safeEdgeFrom = escape(e.from);
                const safeEdgeTo = escape(e.to);
                // safe: structural template; safe* fields are escape()-wrapped;
                // class names + arrow string are author-controlled.
                return `
                    <div class="package-edge-row" data-from="${safeEdgeFrom}" data-to="${safeEdgeTo}">
                        <a href="#" class="package-edge-link" data-target="${safeEdgeFrom}">
                            ${safeEdgeFrom}
                        </a>
                        <span class="package-edge-arrow"> → </span>
                        <span class="package-edge-target">${safeEdgeTo}</span>
                    </div>
                `;
            })
            .join('');

        const emptyHtml =
            fileEdges.length === 0
                ? '<div class="package-edge-empty">No matching file edges in window.GRAPH_DATA — the folder edge may have been computed from edges that are not in the import/call graph.</div>'
                : '';

        // safe: every interpolated value is either a literal author-controlled
        // string or the escape()-wrapped helpers above.
        this.props.el.innerHTML = headerHtml + rowsHtml + emptyHtml;
        this.props.el.style.display = 'block';

        // Wire close + per-row click. Listeners are scoped to props.el so
        // the next show()/hide() innerHTML clear automatically removes them.
        const closeBtn = this.props.el.querySelector('.package-edge-close');
        if (closeBtn !== null) {
            closeBtn.addEventListener('click', () => this.hide());
        }
        const links = this.props.el.querySelectorAll('.package-edge-link');
        links.forEach((link) => {
            link.addEventListener('click', (ev) => {
                ev.preventDefault();
                const target = (ev.currentTarget as HTMLElement).dataset.target;
                if (typeof target === 'string' && target !== '') {
                    this.props.onFileEdgeNavigate(target);
                }
            });
        });
        // Logger reference kept for parity — future debug surfaces hook
        // here without a constructor-shape change.
        void this.logger;
    }

    hide(): void {
        this.props.el.style.display = 'none';
        this.props.el.innerHTML = '';
    }

    unmount(): void {
        this.hide();
    }
}
