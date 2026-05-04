/**
 * PackageView Component (Loop 15).
 *
 * Loop 14 shipped the static-skeleton render path: cards from
 * `dataProvider.loadFolderTree()`. Loop 15 adds the folder-edge layer:
 *
 *   1. Load `dataProvider.loadFolderEdges()` (separate try → cards-only
 *      fallback if it throws).
 *   2. Build a `vis.Network` over the folders (window.vis is loaded via
 *      `<script src="libs/vis-network.min.js">` in src/webview/index.html).
 *   3. Density default: hide edges where `weight < weightP90` (toggle
 *      via the "Show all edges" checkbox in the controls strip).
 *   4. Hover folder node → fade non-incident arcs.
 *   5. Click arc → bottom panel lists the underlying file edges by
 *      re-filtering `window.GRAPH_DATA.importGraph.edges` (or
 *      `callGraph.edges`) via a browser-pure `folderOf()` duplicate.
 *   6. Click folder node → `state.set({ currentView: 'graph', ... })`.
 *
 * Uses `import type` for `FolderTreeData` / `FolderNode` /
 * `FolderEdgelistData` / `FolderEdge` so the runtime bundle stays
 * browser-clean (no `path` / `replaceAll` from `src/graph/folder-tree.ts`
 * or `src/graph/folder-edges.ts`). Esbuild elides type-only imports.
 *
 * Loop 16 will land:
 *   - Visual polish (CSS for the new class names below).
 *   - Description panel + `state.selectedFolder` field.
 *   - Header tri-state toggle (Graph / Design / Packages).
 *   - Router visibility toggle re-enable.
 */

import type { FolderTreeData, FolderNode } from '../../../graph/folder-tree';
import type { FolderEdgelistData, FolderEdge } from '../../../graph/folder-edges';
import { DataProvider } from '../services/dataProvider';
import { State } from '../state';
import { AppState, DesignDoc } from '../types';
import { escape } from '../utils/escape';
import { DesignRender } from './DesignRender';

/**
 * Minimal vis-network surface used by PackageView. The lib is loaded
 * via <script src="libs/vis-network.min.js"> (see src/webview/index.html
 * loop 15) and attaches `window.vis` synchronously. We declare only the
 * methods PackageView calls — adding @types/vis-network would inflate
 * the type surface without adding runtime safety.
 *
 * Cross-reference: src/graph/plot/template.ts uses the same `vis.Network`
 * constructor but in a standalone HTML template, not a webview component.
 */
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

interface VisNetworkNode {
    id: string;
    label: string;
    shape?: 'box' | 'circle' | 'ellipse';
    /** vis-network supports HTML labels via `font.multi: 'html'`. */
    title?: string;
}

interface VisNetworkEdge {
    /** Stable per-edge id so events can identify which edge fired. */
    id: string;
    from: string;
    to: string;
    /** vis-network expects a string color or { color, opacity }. */
    color?: string | { color?: string; opacity?: number };
    width?: number;
    label?: string;
    title?: string;
    /** Round-trip of the underlying FolderEdge for click-handler use. */
    __folderEdge?: FolderEdge;
}

interface VisNetworkOptions {
    physics?: boolean | { enabled: boolean };
    interaction?: {
        hover?: boolean;
        selectConnectedEdges?: boolean;
        dragNodes?: boolean;
        dragView?: boolean;
        zoomView?: boolean;
    };
    edges?: { smooth?: boolean | { type: string }; arrows?: { to?: { enabled: boolean } } };
    nodes?: { shape?: string; font?: { multi?: string } };
}

interface VisNetworkInstance {
    on(
        event: 'click' | 'hoverNode' | 'blurNode' | 'hoverEdge' | 'blurEdge',
        cb: (params: VisEventParams) => void,
    ): void;
    off(event: 'click' | 'hoverNode' | 'blurNode' | 'hoverEdge' | 'blurEdge'): void;
    destroy(): void;
    /** vis-network's body holds raw DataSet refs; we use it for edge-color mutation. */
    body: {
        data: {
            edges: {
                update: (e: Partial<VisNetworkEdge> & { id: string }) => void;
                getIds: () => string[];
            };
            nodes: { update: (n: Partial<VisNetworkNode> & { id: string }) => void };
        };
    };
}

interface VisEventParams {
    nodes: string[];
    edges: string[];
    /** Pointer position for context menus; unused by loop 15 click-arc. */
    pointer?: { canvas: { x: number; y: number } };
}

/**
 * Browser-pure folder-of-file helper. MUST produce byte-identical
 * output to `folderOf()` in src/graph/folder-edges.ts:101-105 (which
 * uses `path.posix.dirname`).
 *
 * Rules (mirrored from the canonical impl):
 *   1. Replace all backslashes with forward slashes.
 *   2. Find the last forward slash; the folder is everything before it.
 *   3. If there's no slash (top-level file), folder is '.'.
 *
 * Cross-reference: a future schema-split loop unifies this with the
 * canonical helper. For loop 15 the duplicate is intentional — the
 * browser bundle cannot drag in node:path.
 *
 * Test parity: tests/unit/graph/folder-edges.test.ts pins the canonical
 * folderOf shape; tests/unit/web-viewer/package-view-arc-click.test.ts
 * pins this duplicate against the same fixtures.
 */
function folderOf(fileId: string): string {
    const normalized = fileId.replaceAll('\\', '/');
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash === -1) return '.';
    return normalized.slice(0, lastSlash);
}

interface Props {
    el: HTMLElement;
    state: State;
    dataProvider: DataProvider;
}

export class PackageView {
    public el: HTMLElement;
    private state: State;
    private dataProvider: DataProvider;
    private tree: FolderTreeData | null = null;
    private edges: FolderEdgelistData | null = null;
    private network: VisNetworkInstance | null = null;
    /** When true, ignore the weightP90 filter and render every folder edge. */
    private showAllEdges: boolean = false;
    /** Container for the vis-network canvas; created in mount(). */
    private arcContainer: HTMLElement | null = null;
    /** Container for the bottom drill-down panel (Phase B). */
    private bottomPanel: HTMLElement | null = null;
    /** Container for the "Show all edges" toggle (Phase B). */
    private controls: HTMLElement | null = null;
    /** Container for the description panel that renders the selected folder's README (loop 16). */
    private descriptionPanel: HTMLElement | null = null;
    /** In-memory snapshot of the design docs map; populated in mount() (loop 16). */
    private designDocs: Record<string, DesignDoc> = {};
    /** Current DesignRender instance for the description panel; null when no doc shown (loop 16). */
    private descriptionRenderer: DesignRender | null = null;
    /** State subscription teardown (loop 16). */
    private unsubscribe?: () => void;
    /**
     * Per-network mutation snapshot to restore on hoverNode → blurNode.
     * Map of edgeId → original color/width. Cleared on blur.
     */
    private hoverSnapshot: Map<string, { color: VisNetworkEdge['color']; width?: number }> =
        new Map();

    constructor({ el, state, dataProvider }: Props) {
        this.el = el;
        this.state = state;
        this.dataProvider = dataProvider;
    }

    async mount(): Promise<void> {
        try {
            this.tree = await this.dataProvider.loadFolderTree();
        } catch (err) {
            // Loop 14 empty-state preserved: failure-to-load tree is the
            // expected path on a fresh repo. We render an empty state and
            // never reach the edge-loading block.
            const safeMessage = escape(String((err as Error)?.message ?? 'Failed to load folder tree'));
            // safe: structural template; message is escape()-wrapped.
            this.el.innerHTML = `<div class="package-empty">${safeMessage}</div>`;
            return;
        }

        // Loop 15: separate try around edges so a tree-OK / edges-FAIL repo
        // still renders the cards. Edge load failure is logged, not surfaced
        // to the user — they get the cards (loop 14 contract) plus a console
        // warning. A fresh-repo / no-scan scenario is the failure mode here.
        try {
            this.edges = await this.dataProvider.loadFolderEdges();
        } catch (err) {
            console.warn(
                '[PackageView] loadFolderEdges failed; rendering cards-only.',
                err,
            );
            this.edges = null;
        }

        this.render(this.tree.root);

        // Phase A: fire the network setup unconditionally. setupNetwork()
        // bails out cleanly if edges is null OR window.vis is missing OR
        // the arc container couldn't be created.
        this.setupNetwork();

        // Loop 16: load design docs for the description panel. Wrapped in
        // try/catch because (a) loop 14/15 test stubs do not implement
        // loadDesignDocs and (b) a fresh repo with no .arch/ shouldn't
        // bring down the cards/arcs render. On failure, keep the cards but
        // skip the description-panel feature (renderDescriptionPanel falls
        // through to the empty-state suggestion).
        try {
            this.designDocs = await this.dataProvider.loadDesignDocs();
        } catch (err) {
            console.warn(
                '[PackageView] loadDesignDocs failed; description panel disabled.',
                err,
            );
            this.designDocs = {};
        }

        // Wire delegated card-click + state subscription AFTER render() so
        // the .package-tree element exists.
        this.attachCardClickHandler();
        this.unsubscribe = this.state.subscribe((s: AppState) =>
            this.onStateChange(s),
        );
    }

    private render(root: FolderNode): void {
        // Skip the empty root (path: "", name: "") — render its children as
        // the top-level entries.
        const cards = root.children.map((child) => this.renderNode(child, 0)).join('');
        // safe: structural template; renderNode escapes every interpolated
        // string field; class names are author-controlled.
        this.el.innerHTML = `
            <div class="package-controls">
                <!-- Loop 15 Phase B fills this with the show-all-edges toggle -->
            </div>
            <div class="package-tree">${cards}</div>
            <div class="package-arc-container"></div>
            <div class="package-description-panel" style="display:none;"></div>
            <div class="package-bottom-panel" style="display:none;"></div>
        `;
        this.controls = this.el.querySelector('.package-controls');
        this.arcContainer = this.el.querySelector('.package-arc-container');
        this.descriptionPanel = this.el.querySelector('.package-description-panel');
        this.bottomPanel = this.el.querySelector('.package-bottom-panel');
    }

    private renderNode(node: FolderNode, depth: number): string {
        const safeName = escape(node.name);
        const safePath = escape(node.path);
        const documentedGlyph = node.documented
            ? '<span class="package-glyph" title="documented">✎</span>'
            : '';
        // Depth-based margin-left: 16px per level. Cheap to override later.
        const indentStyle = `margin-left:${depth * 16}px`;
        const childCards = node.children
            .map((c) => this.renderNode(c, depth + 1))
            .join('');
        // safe: structural template; safeName / safePath are escape()-wrapped;
        // documentedGlyph is a controlled literal; depth is a number;
        // indentStyle is a controlled string.
        return `
            <div class="package-card" data-path="${safePath}" style="${indentStyle}">
                <span class="package-name">${safeName}</span>
                <span class="package-count">${node.fileCount} files</span>
                ${documentedGlyph}
            </div>
            ${childCards}
        `;
    }

    /**
     * Build the vis-network arc visualization. Bails out cleanly when:
     *   - this.edges is null (loadFolderEdges failed; cards-only fallback)
     *   - this.tree is null (defensive)
     *   - window.vis is missing (lib failed to load — surfaces a console error)
     *   - this.arcContainer is missing (defensive)
     *
     * Uses the weightP90 density filter unless this.showAllEdges is true.
     */
    private setupNetwork(): void {
        if (this.edges === null || this.tree === null) return;
        if (this.arcContainer === null) return;

        if (typeof window.vis === 'undefined' || window.vis === null) {
            // The vis-network <script> failed to load (libs/ missing,
            // generator skipped libs, etc.). Surface the gap loudly so a
            // missing file is debuggable, but do NOT throw — cards still
            // render.
            console.error(
                '[PackageView] window.vis is undefined — vis-network.min.js failed to load. ' +
                'Cards render but folder arcs are skipped. Check src/webview/index.html ' +
                'has <script src="libs/vis-network.min.js"> and the generator copied libs/.',
            );
            return;
        }

        const visNodes = this.buildVisNodes(this.tree.root);
        const visEdges = this.buildVisEdges(this.edges);

        // Empty cases: zero nodes (no folders) or zero edges (after
        // density filtering). Render the empty arc area; loop 16 may
        // overlay a "no edges above the p90 threshold — toggle 'Show
        // all'" placeholder.
        if (visNodes.length === 0) {
            console.log('[PackageView] no folder nodes — skipping network');
            return;
        }

        try {
            this.network = new window.vis.Network(
                this.arcContainer,
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
            console.error('[PackageView] vis.Network construction failed', err);
            this.network = null;
            return;
        }

        // Phase B: render the controls strip + wire interaction handlers.
        this.renderControls();
        this.attachNetworkHandlers();
    }

    private buildVisNodes(root: FolderNode): VisNetworkNode[] {
        const out: VisNetworkNode[] = [];
        const walk = (node: FolderNode): void => {
            // Skip the synthetic empty root (path: '', name: '') — same
            // skip rule as render() / renderNode() in loop 14.
            if (node.path !== '' || node.name !== '') {
                out.push({
                    id: node.path,
                    label: node.name,
                    shape: 'box',
                    title: `${node.path} (${node.fileCount} files)`,
                });
            }
            for (const child of node.children) walk(child);
        };
        walk(root);
        return out;
    }

    private buildVisEdges(edgeList: FolderEdgelistData): VisNetworkEdge[] {
        const threshold = this.showAllEdges ? 0 : edgeList.weightP90;
        const out: VisNetworkEdge[] = [];
        for (let i = 0; i < edgeList.edges.length; i++) {
            const e = edgeList.edges[i];
            if (e.weight < threshold) continue;
            // Stable id: kind|from|to. There's at most one edge per
            // (kind, from, to) tuple after the loop-08 bucketing rule,
            // so this id is unique within the edgelist.
            const id = `${e.kind}|${e.from}|${e.to}`;
            out.push({
                id,
                from: e.from,
                to: e.to,
                width: Math.min(1 + Math.log2(e.weight + 1), 6),
                label: String(e.weight),
                // Color encodes kind: imports blue, calls orange. The
                // exact colors land via CSS variables in loop 16; these
                // hardcoded literals are the loop-15 placeholder.
                color: e.kind === 'import' ? '#5b8def' : '#e8a23a',
                title: `${e.kind}: ${e.from} → ${e.to} (weight ${e.weight})`,
                __folderEdge: e,
            });
        }
        return out;
    }

    /**
     * Wire vis-network event listeners. Phase B: the hover-highlight,
     * click-arc, click-card handlers.
     */
    private attachNetworkHandlers(): void {
        if (this.network === null) return;
        this.network.on('hoverNode', (params) => this.handleHoverNode(params));
        this.network.on('blurNode', () => this.handleBlurNode());
        this.network.on('click', (params) => this.handleNetworkClick(params));
    }

    /**
     * Hover a folder node → highlight its incident edges (in + out) and
     * fade the rest. Non-incident edges drop to opacity ~0.15 via
     * vis-network's color mutation API. The original colors are
     * snapshotted in this.hoverSnapshot so blur restores them.
     *
     * params.nodes is a single-element array with the folder path
     * (vis-network fires hoverNode per node). We treat empty nodes
     * defensively as no-op.
     */
    private handleHoverNode(params: VisEventParams): void {
        if (this.network === null || this.edges === null) return;
        if (params.nodes.length === 0) return;

        const hoveredFolder = params.nodes[0];

        // We need the rendered edge ids — same as buildVisEdges' id format.
        // The current vis-network DataSet only exposes the rendered subset
        // (post-density-filter), which is exactly what we want.
        const renderedEdgeIds = this.network.body.data.edges.getIds();

        this.hoverSnapshot.clear();

        for (const edgeId of renderedEdgeIds) {
            // Reconstruct the FolderEdge tuple from the id (kind|from|to).
            // Cheaper than maintaining a Map<id, edge> alongside the DataSet.
            const parts = edgeId.split('|');
            if (parts.length !== 3) continue;
            const [, edgeFrom, edgeTo] = parts;

            const isIncident = edgeFrom === hoveredFolder || edgeTo === hoveredFolder;
            if (isIncident) continue;

            // Fade the non-incident edge.
            this.hoverSnapshot.set(edgeId, { color: undefined }); // placeholder; restoration is by re-render
            this.network.body.data.edges.update({
                id: edgeId,
                color: { color: '#bbb', opacity: 0.15 },
            });
        }
    }

    /**
     * Blur the hovered node → restore all rendered edges to their
     * original color/width. Easiest correct way: rebuild the
     * vis-network edges from this.edges via buildVisEdges() (already
     * applies the density filter). vis-network's update() with a full
     * color object replaces the override.
     */
    private handleBlurNode(): void {
        if (this.network === null || this.edges === null) return;
        if (this.hoverSnapshot.size === 0) return;

        // Rebuild the visible edges and update their colors back to
        // the kind-based palette. Same buildVisEdges call site as
        // setupNetwork() so the rendering is byte-identical post-restore.
        const restored = this.buildVisEdges(this.edges);
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
     * vis-network's 'click' event fires once with `params.nodes[]` and
     * `params.edges[]`. When both are non-empty, the user clicked the
     * intersection — we prefer node-click (folder card behavior). When
     * only edges is non-empty, it's an arc click → bottom panel.
     */
    private handleNetworkClick(params: VisEventParams): void {
        if (params.nodes.length > 0) {
            this.handleNodeClick(params.nodes[0]);
            return;
        }
        if (params.edges.length > 0) {
            this.handleEdgeClick(params.edges[0]);
            return;
        }
        // Empty click — clear the bottom panel.
        this.hideBottomPanel();
    }

    /**
     * Click a folder node in the vis-network arc layer → route to the
     * 'graph' view scoped to that folder's path. Loop 16 keeps this drill-
     * down behavior on the network nodes; the description-panel update
     * lives on the .package-card click handler in attachCardClickHandler()
     * and stays inside the 'packages' route.
     */
    private handleNodeClick(folderPath: string): void {
        this.state.set({
            currentView: 'graph',
            selectedPath: folderPath,
            selectedType: 'directory',
            selectionSource: 'graph',
        });
    }

    /**
     * Loop 16: delegated click handler on the .package-tree container.
     * Clicking a folder card updates the selectedPath/selectedType so the
     * description panel renders the README for that folder. We do NOT
     * change currentView — the click stays inside the 'packages' route.
     */
    private attachCardClickHandler(): void {
        const tree = this.el.querySelector('.package-tree');
        if (tree === null) return;
        tree.addEventListener('click', (ev) => {
            const card = (ev.target as HTMLElement).closest('.package-card');
            if (card === null) return;
            const path = (card as HTMLElement).dataset.path ?? '';
            this.handleCardClick(path);
        });
    }

    private handleCardClick(folderPath: string): void {
        this.state.set({
            selectedPath: folderPath,
            selectedType: 'directory',
            selectionSource: 'graph',
        });
    }

    /**
     * Loop 16: react to state changes. Only the 'packages' route renders
     * the description panel — bail out for other routes so we don't leak
     * a stale README into the design pane.
     */
    private onStateChange(s: AppState): void {
        if (s.currentView !== 'packages') return;
        if (s.selectedType !== 'directory' || s.selectedPath === null) {
            this.hideDescriptionPanel();
            return;
        }
        this.renderDescriptionPanel(s.selectedPath);
    }

    /**
     * Loop 16: render the README for the selected folder via DesignRender.
     *
     * Key resolution mirrors DesignTextView.fetchDesignDoc:462-471 — a
     * directory's README may be served as `<path>/README.html` (after the
     * arch-store .md → .html converter pipeline runs), `<path>/README.txt`,
     * or the original `<path>/README.md`. Try each in that order so we
     * succeed regardless of which converter shape the host emits.
     */
    private renderDescriptionPanel(folderPath: string): void {
        if (this.descriptionPanel === null) return;
        const candidates = [
            `${folderPath}/README.html`,
            `${folderPath}/README.txt`,
            `${folderPath}/README.md`,
        ];
        let doc: DesignDoc | undefined;
        for (const key of candidates) {
            if (this.designDocs[key] !== undefined) {
                doc = this.designDocs[key];
                break;
            }
        }
        if (doc === undefined) {
            const safePath = escape(folderPath);
            // safe: structural template; safePath is escape()-wrapped;
            // surrounding strings are author-controlled literals.
            this.descriptionPanel.innerHTML =
                `<div class="package-description-empty">` +
                `No design doc yet — run <code>llmem document ${safePath}</code>.` +
                `</div>`;
            this.descriptionPanel.style.display = 'block';
            this.descriptionRenderer = null;
            return;
        }
        // Use DesignRender in 'view' mode — package view is read-only;
        // onModeChange is a no-op and onSave is omitted.
        this.descriptionRenderer = new DesignRender({
            markdown: doc.markdown,
            html: doc.html,
            mode: 'view',
            onModeChange: () => {
                /* no-op: package view is read-only */
            },
        });
        this.descriptionPanel.innerHTML = '';
        this.descriptionPanel.style.display = 'block';
        this.descriptionRenderer.mount(this.descriptionPanel);
    }

    private hideDescriptionPanel(): void {
        if (this.descriptionPanel === null) return;
        this.descriptionPanel.style.display = 'none';
        this.descriptionPanel.innerHTML = '';
        this.descriptionRenderer = null;
    }

    /**
     * Click a folder→folder arc → re-filter
     * window.GRAPH_DATA.importGraph.edges and
     * window.GRAPH_DATA.callGraph.edges for endpoints whose folder
     * matches the arc's (from, to) tuple. Render the result into the
     * bottom panel.
     *
     * The arc's underlying FolderEdge is round-tripped via __folderEdge
     * on the VisNetworkEdge; we look it up via the edge id.
     */
    private handleEdgeClick(edgeId: string): void {
        if (this.edges === null) return;
        const folderEdge = this.findFolderEdgeById(edgeId);
        if (folderEdge === null) {
            console.warn('[PackageView] click on unknown arc id', edgeId);
            return;
        }
        this.renderBottomPanel(folderEdge);
    }

    private findFolderEdgeById(edgeId: string): FolderEdge | null {
        if (this.edges === null) return null;
        const parts = edgeId.split('|');
        if (parts.length !== 3) return null;
        const [kind, from, to] = parts;
        if (kind !== 'import' && kind !== 'call') return null;
        for (const e of this.edges.edges) {
            if (e.kind === kind && e.from === from && e.to === to) return e;
        }
        return null;
    }

    /**
     * Render the bottom panel listing the underlying file edges that
     * roll up into the clicked folder arc. Filters
     * window.GRAPH_DATA.importGraph.edges (and call edges) by
     * folderOf(from/to) === folderEdge.from / .to.
     *
     * Each row links back to the 'graph' route scoped to one of the
     * file endpoints (we choose `from` since "what does this folder
     * call out to" is the more natural mental model).
     */
    private renderBottomPanel(folderEdge: FolderEdge): void {
        if (this.bottomPanel === null) return;

        // Pull the right edge list based on the folder edge's kind.
        const graphData = window.GRAPH_DATA;
        if (graphData === undefined) {
            // safe: structural template; controlled message string.
            this.bottomPanel.innerHTML =
                '<div class="package-edge-empty">window.GRAPH_DATA not available</div>';
            this.bottomPanel.style.display = 'block';
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
                // class names and arrow string are author-controlled.
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

        const emptyHtml = fileEdges.length === 0
            ? '<div class="package-edge-empty">No matching file edges in window.GRAPH_DATA — the folder edge may have been computed from edges that are not in the import/call graph.</div>'
            : '';

        // safe: every interpolated value is either a literal author-controlled
        // string or the escape()-wrapped helpers above.
        this.bottomPanel.innerHTML = headerHtml + rowsHtml + emptyHtml;
        this.bottomPanel.style.display = 'block';

        // Wire close + per-row click. Listeners are scoped to bottomPanel,
        // so unmount()'s innerHTML clear automatically removes them.
        const closeBtn = this.bottomPanel.querySelector('.package-edge-close');
        if (closeBtn !== null) {
            closeBtn.addEventListener('click', () => this.hideBottomPanel());
        }
        const links = this.bottomPanel.querySelectorAll('.package-edge-link');
        links.forEach((link) => {
            link.addEventListener('click', (ev) => {
                ev.preventDefault();
                const target = (ev.currentTarget as HTMLElement).dataset.target;
                if (typeof target === 'string' && target !== '') {
                    this.state.set({
                        currentView: 'graph',
                        selectedPath: target,
                        selectedType: 'file',
                        selectionSource: 'graph',
                    });
                }
            });
        });
    }

    private hideBottomPanel(): void {
        if (this.bottomPanel === null) return;
        this.bottomPanel.style.display = 'none';
        this.bottomPanel.innerHTML = '';
    }

    /**
     * Render the show-all-edges checkbox in the controls strip. Called
     * from setupNetwork() AFTER the network is built (so toggling can
     * call setupNetwork-equivalent rebuild logic). Loop 16 may extend
     * the controls strip with sort options, edge-kind filters, etc.
     */
    private renderControls(): void {
        if (this.controls === null) return;
        const checked = this.showAllEdges ? 'checked' : '';
        // safe: structural template; controlled class names; boolean state
        // → controlled "checked" / "" string; no user data.
        this.controls.innerHTML = `
            <label class="package-controls-toggle">
                <input type="checkbox" class="package-show-all-edges" ${checked} />
                <span>Show all edges</span>
            </label>
        `;
        const checkbox = this.controls.querySelector('.package-show-all-edges');
        if (checkbox !== null) {
            checkbox.addEventListener('change', (ev) => {
                const target = ev.currentTarget as HTMLInputElement;
                this.handleShowAllToggle(target.checked);
            });
        }
    }

    /**
     * Toggle handler: swap the showAllEdges flag, rebuild the visible
     * edges, and replace the network's edge dataset. We do NOT destroy
     * + recreate the network gracefully via the DataSet API — the
     * minimal type surface only exposes update() and getIds(). The
     * cleanest path with the current types: destroy + setupNetwork()
     * again. Profile if performance bites — for < 200 folders the
     * destroy + reconstruct is sub-50ms.
     */
    private handleShowAllToggle(showAll: boolean): void {
        this.showAllEdges = showAll;
        if (this.network !== null) {
            try {
                this.network.destroy();
            } catch (err) {
                console.warn('[PackageView] network.destroy() during toggle threw', err);
            }
            this.network = null;
        }
        this.hoverSnapshot.clear();
        this.hideBottomPanel();
        this.setupNetwork();
    }

    unmount(): void {
        if (this.network !== null) {
            try {
                this.network.destroy();
            } catch (err) {
                console.warn('[PackageView] network.destroy() threw', err);
            }
            this.network = null;
        }
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.el.innerHTML = '';
        this.tree = null;
        this.edges = null;
        this.arcContainer = null;
        this.bottomPanel = null;
        this.controls = null;
        this.descriptionPanel = null;
        this.descriptionRenderer = null;
        this.designDocs = {};
        this.showAllEdges = false;
        this.hoverSnapshot.clear();
    }
}
