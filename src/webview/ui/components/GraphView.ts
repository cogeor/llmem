/**
 * Graph View Component
 * 
 * Displays the hierarchical graph visualization using D3.js.
 * The graph is rendered once on mount, then navigation only
 * moves the camera and highlights neighbors.
 */

import { GraphRenderer } from "../graph/GraphRenderer";
import { GraphDataService } from "../services/graphDataService";
import { WorktreeService } from "../services/worktreeService";
import { AppState, GraphData, WorkTreeNode } from "../types";

interface Props {
    el: HTMLElement;
    state: any;
    graphDataService: GraphDataService;
    worktreeService: WorktreeService;
}

export class GraphView {
    public el: HTMLElement;
    private state: any;
    private graphDataService: GraphDataService;
    private worktreeService: WorktreeService;
    private graphRenderer: GraphRenderer | null = null;
    private data: GraphData | null = null;
    private worktree: WorkTreeNode | null = null;
    private unsubscribe?: () => void;
    private isRendered: boolean = false;
    private currentGraphType: string = 'import';

    constructor({ el, state, graphDataService, worktreeService }: Props) {
        this.el = el;
        this.state = state;
        this.graphDataService = graphDataService;
        this.worktreeService = worktreeService;
    }

    async mount() {
        // Load data
        this.data = await this.graphDataService.load();
        this.worktree = await this.worktreeService.load();

        console.log('[GraphView] Data loaded:', {
            importNodes: this.data?.importGraph?.nodes?.length,
            callNodes: this.data?.callGraph?.nodes?.length,
            worktree: this.worktree?.name
        });

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
            console.warn('[GraphView] Cannot initialize: data or worktree not loaded');
            return;
        }

        const canvasEl = this.el.querySelector('.graph-canvas') as HTMLElement;
        if (!canvasEl) {
            console.warn('[GraphView] Cannot initialize: canvas element not found');
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

        console.log('[GraphView] Initializing graph:', { graphType, width, height });

        // Clear canvas
        canvasEl.innerHTML = '';

        // Create new renderer
        this.graphRenderer = new GraphRenderer(canvasEl, {
            width,
            height,
            onNodeClick: (nodeId: string) => this.handleNodeClick(nodeId),
            onFolderClick: (folderPath: string) => this.handleFolderClick(folderPath),
            onFileClick: (filePath: string) => this.handleFileClick(filePath)
        });

        // Get the appropriate graph
        const graph = graphType === "import"
            ? this.data.importGraph
            : this.data.callGraph;

        try {
            // Render the full graph
            this.graphRenderer.render(graph, this.worktree, graphType as 'import' | 'call');

            this.currentGraphType = graphType;
            this.isRendered = true;

            console.log('[GraphView] Graph rendered successfully');
        } catch (err: any) {
            console.error('[GraphView] Render error:', err);
            canvasEl.innerHTML = `<div style="padding:20px; color:red">Error rendering graph: ${err.message}<br><pre>${err.stack}</pre></div>`;
            canvasEl.style.display = 'block';
        }
    }

    /**
     * Handle state changes - pan camera and highlight as needed.
     */
    onState({ currentView, graphType, selectedPath, selectedType }: AppState) {
        // In 3-column layout, graph is always visible
        // if (currentView !== "graph") { return; }


        const canvasEl = this.el.querySelector('.graph-canvas') as HTMLElement;

        // If graph type changed, re-initialize
        if (graphType !== this.currentGraphType) {
            this.isRendered = false;
        }

        // Always show the canvas when in graph view, initialize graph first
        canvasEl.style.display = 'block';

        // Initialize graph if not yet rendered
        if (!this.isRendered) {
            this.initializeGraph(graphType);
            // Clear any default selection from design view - graph starts fresh
            return;
        }

        if (!selectedPath) {
            // Show message overlay on top of graph - REMOVED
            return;
        }

        // msgEl.style.display = 'none'; // REMOVED

        if (!this.graphRenderer) return;

        // Clear previous highlights
        this.graphRenderer.clearHighlight();

        // Pan camera and highlight based on selection type
        if (selectedType === "file") {
            // For call graphs, files are containers - highlight the file box
            // For import graphs, files ARE the nodes - highlight neighbors
            if (graphType === 'call') {
                this.graphRenderer.highlightFile(selectedPath);
            } else {
                this.graphRenderer.panTo(selectedPath, true);
                this.graphRenderer.highlightNeighbors(selectedPath);
            }
        } else if (selectedType === "directory") {
            this.graphRenderer.panToFolder(selectedPath, true);
            this.graphRenderer.highlightFolder(selectedPath);
        }
    }

    /**
     * Handle node click from graph.
     */
    private handleNodeClick(nodeId: string): void {
        // For call graph nodes, ID is like "src/file.ts#functionName"
        // Extract the file path by removing the function part (after #)
        let filePath = nodeId;
        const hashIndex = nodeId.lastIndexOf('#');
        if (hashIndex > 0) {
            // Has a hash separator - extract file path
            filePath = nodeId.substring(0, hashIndex);
        }

        // Update app state to reflect selection
        this.state.set({
            selectedPath: filePath,
            selectedType: 'file'
        });
    }

    /**
     * Handle folder click from graph.
     */
    private handleFolderClick(folderPath: string): void {
        // Update app state to reflect folder selection
        this.state.set({
            selectedPath: folderPath,
            selectedType: 'directory'
        });
    }

    /**
     * Handle file click from graph.
     */
    private handleFileClick(filePath: string): void {
        // Update app state to reflect file selection - this will highlight in explorer
        this.state.set({
            selectedPath: filePath,
            selectedType: 'file'
        });
    }

    /**
     * Handle theme changes - re-render graph with new colors.
     */
    private handleThemeChange = () => {
        // For theme changes, we'd need to update CSS variables
        // The SVG elements use CSS variables so they should update automatically
        // But we might need to force a redraw for some elements
    };

    /**
     * Cleanup on unmount.
     */
    unmount() {
        this.unsubscribe?.();
        window.removeEventListener('theme-changed', this.handleThemeChange);
        this.resizeObserver?.disconnect();
        this.graphRenderer?.destroy();
    }

    // --- Resize Handling ---
    private resizeObserver: ResizeObserver | null = null;
    private resizeTimeout: any = null;

    private setupResizeObserver() {
        if (this.resizeObserver) return;

        const container = this.el.parentElement; // The pane
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
            // Force measurement or default
            let width = this.el.clientWidth;
            let height = this.el.clientHeight;

            // If hidden or 0, use defaults to prevent collapse
            if (width === 0) width = 1000;
            if (height === 0) height = 800;

            console.log('[GraphView] handleResize:', { width, height, time: Date.now() });

            if (this.graphRenderer) {
                this.graphRenderer.resize(width, height);
                // Re-render to update layout (binning)
                if (this.data && this.worktree) {
                    const graph = this.currentGraphType === "import"
                        ? this.data.importGraph
                        : this.data.callGraph;
                    this.graphRenderer.render(graph, this.worktree, this.currentGraphType as any);
                }
            } else {
                // If resize happens before initial render, we might need to kick it
                console.log('[GraphView] Resize triggered but no renderer yet');
            }
        }, 100); // 100ms debounce
    }
}
