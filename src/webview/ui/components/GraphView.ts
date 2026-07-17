/**
 * Graph View Component
 * 
 * Displays the hierarchical graph visualization using D3.js.
 * The graph is rendered once on mount, then navigation only
 * moves the camera and highlights neighbors.
 */

import { GraphRenderer } from "../graph/GraphRenderer";
import { DataProvider } from "../services/dataProvider";
import { State } from "../state";
import { AppState, GraphData, WorkTreeNode } from "../types";
import { escape } from "../utils/escape";
import { WebviewLogger, createWebviewLogger } from "../services/webview-logger";
import {
    EMPTY_STATE_MESSAGE,
    shouldShowGraphEmptyState,
} from "./graph-empty-state";
import { findNode, collectSubtreeFiles } from "./graphViewWorktree";
import {
    nodeClickSelection,
    folderClickSelection,
    fileClickSelection,
} from "./graphViewSelection";

interface Props {
    el: HTMLElement;
    state: State;
    dataProvider: DataProvider;
    logger?: WebviewLogger;
}

export class GraphView {
    public el: HTMLElement;
    private state: State;
    private dataProvider: DataProvider;
    private graphRenderer: GraphRenderer | null = null;
    private data: GraphData | null = null;
    private worktree: WorkTreeNode | null = null;
    private unsubscribe?: () => void;
    private isRendered: boolean = false;
    private currentGraphType: string = 'import';
    private logger: WebviewLogger;
    // Loop 05: overlay element shown when scan-has-data but watched=0.
    // Lifecycle is owned entirely by renderEmptyState/removeEmptyState; the
    // D3 canvas under `.graph-canvas` is not touched.
    private emptyStateEl: HTMLElement | null = null;

    constructor({ el, state, dataProvider, logger }: Props) {
        this.el = el;
        this.state = state;
        this.dataProvider = dataProvider;
        this.logger = logger ?? createWebviewLogger({ enabled: false });
    }

    async mount() {
        // Destroy old renderer to force full re-render with fresh data
        if (this.graphRenderer) {
            this.graphRenderer.destroy();
            this.graphRenderer = null;
        }
        this.isRendered = false;

        // Load data
        this.data = await this.dataProvider.loadGraphData();
        this.worktree = await this.dataProvider.loadWorkTree();

        // Determine if call graph is available (has nodes)
        // Backend filters to TS/JS only, so if there are nodes, call graph is available
        const callGraphAvailable = (this.data?.callGraph?.nodes?.length ?? 0) > 0;

        // Update state with callGraphAvailable (backend determined)
        this.state.set({ callGraphAvailable });

        // Subscribe to state changes
        this.unsubscribe = this.state.subscribe((s: AppState) => this.onState(s));

        // Listen for theme changes
        window.addEventListener('theme-changed', this.handleThemeChange);

        // Initial render
        const initialState = this.state.get() as AppState;
        this.onState(initialState);

        this.setupResizeObserver();
    }

    /**
     * Initialize the D3 graph renderer and render the graph.
     */
    private initializeGraph(graphType: string): void {
        if (!this.data || !this.worktree) {
            this.logger.warn('[GraphView] Cannot initialize: data or worktree not loaded');
            return;
        }

        const canvasEl = this.el.querySelector('.graph-canvas') as HTMLElement;
        if (!canvasEl) {
            this.logger.warn('[GraphView] Cannot initialize: canvas element not found');
            return;
        }

        // Clean up previous renderer if graph type changed
        if (this.graphRenderer && this.currentGraphType !== graphType) {
            this.graphRenderer.destroy();
            this.graphRenderer = null;
            this.isRendered = false;
        }

        if (this.isRendered) {
            return;
        }

        // Get canvas dimensions - use defaults if hidden
        const width = canvasEl.clientWidth || 1200;
        const height = canvasEl.clientHeight || 800;

        this.logger.log('[GraphView] Initializing graph:', { graphType, width, height });

        // safe: empty string clearing the element.
        canvasEl.innerHTML = '';

        // Create new renderer — thread the logger through so the graph
        // call tree shares one gating decision (Loop 14).
        this.graphRenderer = new GraphRenderer(canvasEl, {
            width,
            height,
            onNodeClick: (nodeId: string) => this.handleNodeClick(nodeId),
            onFolderClick: (folderPath: string) => this.handleFolderClick(folderPath),
            onFileClick: (filePath: string) => this.handleFileClick(filePath)
        }, this.logger);

        // Get the appropriate graph
        const graph = graphType === "import"
            ? this.data.importGraph
            : this.data.callGraph;

        try {
            // Render the full graph
            this.graphRenderer.render(graph, this.worktree, graphType as 'import' | 'call');

            this.currentGraphType = graphType;
            this.isRendered = true;

            this.logger.log('[GraphView] Graph rendered successfully');
        } catch (err: unknown) {
            this.logger.error('[GraphView] Render error:', err);
            // Loop 13: error.message/.stack can carry user-controlled path
            // fragments — HTML-escape before interpolation into the display.
            const e = err as { message?: unknown; stack?: unknown };
            const safeMessage = escape(String(e?.message ?? 'unknown'));
            const safeStack = escape(String(e?.stack ?? ''));
            // safe: structural template with escape()-wrapped error fields.
            canvasEl.innerHTML = `<div style="padding:20px; color:red">Error rendering graph: ${safeMessage}<br><pre>${safeStack}</pre></div>`;
            canvasEl.style.display = 'block';
        }
    }

    /**
     * Handle state changes - pan camera and highlight as needed.
     */
    onState({ graphType, selectedPath, selectedType, selectionSource, watchedPaths }: AppState) {
        const canvasEl = this.el.querySelector('.graph-canvas') as HTMLElement;

        // Loop 05: drive the empty-state overlay from the same subscription
        // tick. Evaluated BEFORE the early returns below so that toggling a
        // file (which leaves selectedPath/graphType unchanged) still hides
        // the overlay, and the synchronous initial subscribe-callback fires
        // it on mount when scan-has-data but watched=0.
        const importNodeCount = this.data?.importGraph?.nodes?.length ?? 0;
        if (shouldShowGraphEmptyState(importNodeCount, watchedPaths)) {
            this.renderEmptyState();
        } else {
            this.removeEmptyState();
        }

        // If graph type changed, re-initialize
        if (graphType !== this.currentGraphType) {
            this.isRendered = false;
        }

        // Always show the canvas
        canvasEl.style.display = 'block';

        // Initialize graph if not yet rendered
        if (!this.isRendered) {
            this.initializeGraph(graphType);
            return;
        }

        if (!selectedPath) {
            return;
        }

        if (!this.graphRenderer) return;

        // When selection comes from graph clicks, the graph's own click handlers
        // already applied the correct highlight. Only respond when from explorer.
        if (selectionSource !== 'explorer') {
            return;
        }

        // Clear previous highlights
        this.graphRenderer.clearHighlight();

        // Pan camera to the selected element
        if (selectedType === "file") {
            this.graphRenderer.panToFile(selectedPath);
            if (graphType === 'call') {
                this.graphRenderer.highlightFile(selectedPath);
            } else {
                this.graphRenderer.highlightNeighbors(selectedPath);
            }
        } else if (selectedType === "directory") {
            this.graphRenderer.panToFolder(selectedPath);
            this.graphRenderer.highlightFolder(selectedPath);
        }
    }

    /** Handle node click from graph (selection logic in graphViewSelection). */
    private handleNodeClick(nodeId: string): void {
        this.state.set(nodeClickSelection(nodeId));
    }

    /** Handle folder click from graph. */
    private handleFolderClick(folderPath: string): void {
        this.state.set(folderClickSelection(folderPath));
    }

    /** Handle file click from graph. */
    private handleFileClick(filePath: string): void {
        this.state.set(fileClickSelection(filePath));
    }

    /**
     * Handle theme changes.
     */
    private handleThemeChange = () => {
        // SVG elements use CSS variables so they should update automatically
    };

    /**
     * Loop 05: render the centered empty-state overlay as a sibling to
     * `.graph-canvas` inside `.graph-container`. Idempotent — calling
     * twice is a no-op. The card uses textContent so no escape is needed.
     */
    private renderEmptyState(): void {
        if (this.emptyStateEl) return;
        const overlay = document.createElement('div');
        overlay.className = 'graph-empty-state';
        const card = document.createElement('div');
        card.className = 'graph-empty-state-card';
        card.textContent = EMPTY_STATE_MESSAGE;
        overlay.appendChild(card);
        this.el.appendChild(overlay);
        this.emptyStateEl = overlay;
    }

    /**
     * Loop 05: remove the overlay if present. Idempotent.
     */
    private removeEmptyState(): void {
        if (!this.emptyStateEl) return;
        this.emptyStateEl.remove();
        this.emptyStateEl = null;
    }

    /**
     * Cleanup on unmount.
     */
    unmount() {
        this.unsubscribe?.();
        window.removeEventListener('theme-changed', this.handleThemeChange);
        this.resizeObserver?.disconnect();
        this.graphRenderer?.destroy();
        // Loop 05: defensively drop the overlay — host normally tears down
        // #graph-view's subtree on view switch, but keeping emptyStateEl's
        // lifetime contained here avoids a dangling field reference.
        this.removeEmptyState();
    }

    /** Loop 08: toggle the health overlay on the current graph. */
    setHealthHighlight(on: boolean): void {
        this.graphRenderer?.setHealthHighlight(on);
    }
    /** Smells of a node by id across BOTH graphs (file id OR entity id). */
    getNodeSmells(nodeId: string): GraphData['importGraph']['nodes'][number]['smells'] {
        if (!this.data) return undefined;
        const all = [...this.data.importGraph.nodes, ...this.data.callGraph.nodes];
        return all.find((n) => n.id === nodeId)?.smells;
    }

    // --- Worktree helpers ---

    getNode(path: string): WorkTreeNode | undefined {
        if (!this.worktree) return undefined;
        return findNode(this.worktree, path);
    }

    collectSubtreeFiles(dirNode: WorkTreeNode): Set<string> {
        return collectSubtreeFiles(dirNode);
    }

    // --- Resize Handling ---
    private resizeObserver: ResizeObserver | null = null;
    private resizeTimeout: ReturnType<typeof setTimeout> | null = null;

    private setupResizeObserver() {
        if (this.resizeObserver) return;

        const container = this.el.parentElement;
        if (!container) return;

        this.resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                if (entry.target === container) {
                    this.handleResize();
                }
            }
        });

        this.resizeObserver.observe(container);
    }

    private handleResize() {
        if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
        this.resizeTimeout = setTimeout(() => {
            let width = this.el.clientWidth;
            let height = this.el.clientHeight;

            if (width === 0) width = 1000;
            if (height === 0) height = 800;

            this.logger.log('[GraphView] handleResize:', { width, height, time: Date.now() });

            if (this.graphRenderer) {
                this.graphRenderer.resize(width, height);
                if (this.data && this.worktree) {
                    const graph = this.currentGraphType === "import"
                        ? this.data.importGraph
                        : this.data.callGraph;
                    this.graphRenderer.render(graph, this.worktree, this.currentGraphType as 'import' | 'call');
                }
            } else {
                this.logger.log('[GraphView] Resize triggered but no renderer yet');
            }
        }, 100);
    }
}
