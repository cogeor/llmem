/**
 * FolderArcNetwork — vis-network folder-arc visualization (Loop 15 split).
 *
 * Owns the `.package-arc-container` (vis-network canvas) AND the
 * `.package-controls` strip (the "show all edges" toggle is
 * conceptually network-scoped — flipping it rebuilds the network).
 *
 * The component does NOT touch app state. PackageView (orchestrator)
 * wires three event callbacks:
 *   - `onNodeClick(folderPath)`   — folder node click
 *   - `onEdgeClick(folderEdge)`   — folder→folder arc click
 *   - `onEmptyClick()`            — empty canvas click (close drilldown)
 *
 * This is the only file that references `window.vis` at runtime — the
 * type augmentation lives below and the lookup is local to
 * `setupNetwork()`.
 *
 * Cross-references:
 *   - Pinned by `tests/unit/web-viewer/package-view-edges.test.ts` (default
 *     density, show-all toggle, __folderEdge round-trip, cards-only fallback).
 *   - Pinned by `tests/unit/web-viewer/package-view-arc-click.test.ts`
 *     (arc click, node click, edge-row navigation).
 *   - vis-network.min.js is loaded via `<script>` in
 *     `src/webview/index.html` and attaches `window.vis` synchronously.
 */

import type { FolderTreeData } from '../../../contracts/folder-tree';
import type { FolderEdgelistData, FolderEdge } from '../../../contracts/folder-edges';
import { WebviewLogger, createWebviewLogger } from '../services/webview-logger';
import {
    buildVisNodes,
    buildVisEdges,
    findFolderEdgeById,
    nonIncidentEdgeIds,
    type VisNetworkInstance,
    type VisEventParams,
    type VisNetworkEdge,
    type VisNetworkNode,
    type VisNetworkOptions,
} from './folderViewModel';

declare global {
    interface Window {
        vis?: {
            Network: new (
                container: HTMLElement,
                data: { nodes: VisNetworkNode[]; edges: VisNetworkEdge[] },
                options: VisNetworkOptions,
            ) => VisNetworkInstance;
            DataSet: new <T>(items: T[]) => unknown;
        };
    }
}

export interface FolderArcNetworkProps {
    /** `<div class="package-arc-container">` mount point. */
    arcEl: HTMLElement;
    /** `<div class="package-controls">` mount point. */
    controlsEl: HTMLElement;
    onNodeClick: (folderPath: string) => void;
    onEdgeClick: (folderEdge: FolderEdge) => void;
    onEmptyClick: () => void;
    logger?: WebviewLogger;
}

export class FolderArcNetwork {
    private readonly props: FolderArcNetworkProps;
    private readonly logger: WebviewLogger;

    private network: VisNetworkInstance | null = null;
    private lastTree: FolderTreeData | null = null;
    private lastEdges: FolderEdgelistData | null = null;
    /** When true, ignore the weightP90 filter and render every folder edge. */
    private showAllEdges: boolean = false;
    /**
     * Per-network mutation snapshot to restore on hoverNode → blurNode.
     * Map of edgeId → marker; cleared on blur. The marker is unused —
     * `Set` would be cleaner but keeping `Map` matches the original
     * snapshot-restore contract for byte-identical rebuild.
     */
    private hoverSnapshot: Set<string> = new Set();

    constructor(props: FolderArcNetworkProps) {
        this.props = props;
        this.logger = props.logger ?? createWebviewLogger({ enabled: false });
    }

    /**
     * Build (or rebuild) the vis-network. Bails out cleanly when:
     *   - `edges` is null (loadFolderEdges failed; cards-only fallback)
     *   - `tree` is null
     *   - `window.vis` is missing (lib failed to load — surfaces a console error)
     *   - `arcEl` is missing (defensive)
     */
    render(tree: FolderTreeData, edges: FolderEdgelistData | null): void {
        this.lastTree = tree;
        this.lastEdges = edges;

        // Tear down any prior instance before we rebuild — toggle handler
        // and re-render call this method again.
        this.destroyNetwork();

        if (edges === null) return;

        if (typeof window.vis === 'undefined' || window.vis === null) {
            this.logger.error(
                '[FolderArcNetwork] window.vis is undefined — vis-network.min.js failed to load. ' +
                    'Cards render but folder arcs are skipped. Check src/webview/index.html ' +
                    'has <script src="libs/vis-network.min.js"> and the generator copied libs/.',
            );
            return;
        }

        const visNodes = buildVisNodes(tree.root);
        const visEdges = buildVisEdges(edges, { showAllEdges: this.showAllEdges });

        if (visNodes.length === 0) {
            this.logger.log('[FolderArcNetwork] no folder nodes — skipping network');
            return;
        }

        try {
            this.network = new window.vis.Network(
                this.props.arcEl,
                { nodes: visNodes, edges: visEdges },
                {
                    physics: false, // Folder layout is structural, not force-directed
                    interaction: {
                        hover: true,
                        selectConnectedEdges: false,
                        dragNodes: false,
                        dragView: true,
                        zoomView: true,
                    },
                    nodes: { shape: 'box' },
                    edges: {
                        smooth: { type: 'curvedCW' },
                        arrows: { to: { enabled: true } },
                    },
                },
            );
        } catch (err) {
            this.logger.error('[FolderArcNetwork] vis.Network construction failed', err);
            this.network = null;
            return;
        }

        this.renderControls();
        this.attachNetworkHandlers();
    }

    unmount(): void {
        this.destroyNetwork();
        this.props.controlsEl.innerHTML = '';
        this.lastTree = null;
        this.lastEdges = null;
        this.showAllEdges = false;
    }

    // -----------------------------------------------------------------
    // private
    // -----------------------------------------------------------------

    private destroyNetwork(): void {
        if (this.network !== null) {
            try {
                this.network.destroy();
            } catch (err) {
                this.logger.warn('[FolderArcNetwork] network.destroy() threw', err);
            }
            this.network = null;
        }
        this.hoverSnapshot.clear();
    }

    /** Wire vis-network event listeners (hover/blur/click). */
    private attachNetworkHandlers(): void {
        if (this.network === null) return;
        this.network.on('hoverNode', (params) => this.handleHoverNode(params));
        this.network.on('blurNode', () => this.handleBlurNode());
        this.network.on('click', (params) => this.handleNetworkClick(params));
    }

    /**
     * Hover a folder node → fade non-incident edges. The non-incidence
     * test is delegated to the pure helper in `folderViewModel.ts`.
     */
    private handleHoverNode(params: VisEventParams): void {
        if (this.network === null || this.lastEdges === null) return;
        if (params.nodes.length === 0) return;
        const hoveredFolder = params.nodes[0];

        const renderedIds = this.network.body.data.edges.getIds();
        const toFade = nonIncidentEdgeIds(renderedIds, hoveredFolder);

        this.hoverSnapshot.clear();
        for (const id of toFade) {
            this.hoverSnapshot.add(id);
            this.network.body.data.edges.update({
                id,
                color: { color: '#bbb', opacity: 0.15 },
            });
        }
    }

    /**
     * Blur the hovered node → restore the faded edges to their original
     * color/width by re-running `buildVisEdges` and patching only the
     * snapshotted ids. The byte-identical-rebuild guarantee (same call
     * site as `render`) preserves the loop-14/15 behavior.
     */
    private handleBlurNode(): void {
        if (this.network === null || this.lastEdges === null) return;
        if (this.hoverSnapshot.size === 0) return;

        const restored = buildVisEdges(this.lastEdges, { showAllEdges: this.showAllEdges });
        for (const e of restored) {
            if (this.hoverSnapshot.has(e.id)) {
                this.network.body.data.edges.update({
                    id: e.id,
                    color: e.color,
                    width: e.width,
                });
            }
        }
        this.hoverSnapshot.clear();
    }

    /**
     * vis-network's click event fires once with both `params.nodes[]`
     * and `params.edges[]`. Node-click wins over edge-click when both
     * are non-empty (the user clicked the intersection); empty click
     * surfaces through `onEmptyClick`.
     */
    private handleNetworkClick(params: VisEventParams): void {
        if (params.nodes.length > 0) {
            this.props.onNodeClick(params.nodes[0]);
            return;
        }
        if (params.edges.length > 0) {
            this.handleEdgeClick(params.edges[0]);
            return;
        }
        this.props.onEmptyClick();
    }

    private handleEdgeClick(edgeId: string): void {
        if (this.lastEdges === null) return;
        const folderEdge = findFolderEdgeById(this.lastEdges, edgeId);
        if (folderEdge === null) {
            this.logger.warn('[FolderArcNetwork] click on unknown arc id', edgeId);
            return;
        }
        this.props.onEdgeClick(folderEdge);
    }

    /**
     * Render the show-all-edges checkbox in the controls strip. Toggling
     * the checkbox rebuilds the network in place via `render()`.
     */
    private renderControls(): void {
        const checked = this.showAllEdges ? 'checked' : '';
        // safe: structural template; controlled class names; boolean
        // state → controlled "checked"/"" string; no user data.
        this.props.controlsEl.innerHTML = `
            <label class="package-controls-toggle">
                <input type="checkbox" class="package-show-all-edges" ${checked} />
                <span>Show all edges</span>
            </label>
        `;
        const checkbox = this.props.controlsEl.querySelector('.package-show-all-edges');
        if (checkbox !== null) {
            checkbox.addEventListener('change', (ev) => {
                const target = ev.currentTarget as HTMLInputElement;
                this.handleShowAllToggle(target.checked);
            });
        }
    }

    private handleShowAllToggle(showAll: boolean): void {
        this.showAllEdges = showAll;
        // Drop any stale drill-down panel — the rebuild may hide edges
        // that were drilled into. Mirrors PackageView.handleShowAllToggle's
        // pre-loop-15 hideBottomPanel() call.
        this.props.onEmptyClick();
        if (this.lastTree !== null) {
            this.render(this.lastTree, this.lastEdges);
        }
    }
}
