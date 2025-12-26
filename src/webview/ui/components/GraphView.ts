/**
 * Graph View Component
 * 
 * Displays the hierarchical graph visualization using D3.js.
 * The graph is rendered once on mount, then navigation only
 * moves the camera and highlights neighbors.
 */

import { GraphRenderer } from "../graph/GraphRenderer";
import { DataProvider } from "../services/dataProvider";
import { AppState, GraphData, WorkTreeNode, DirectoryNode } from "../types";

interface Props {
    el: HTMLElement;
    state: any;
    dataProvider: DataProvider;
}

export class GraphView {
    public el: HTMLElement;
    private state: any;
    private dataProvider: DataProvider;
    private graphRenderer: GraphRenderer | null = null;
    private data: GraphData | null = null;
    private worktree: WorkTreeNode | null = null;
    private unsubscribe?: () => void;
    private isRendered: boolean = false;
    private currentGraphType: string = 'import';

    constructor({ el, state, dataProvider }: Props) {
        this.el = el;
        this.state = state;
        this.dataProvider = dataProvider;
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

        console.log('[GraphView] Data loaded:', {
            importNodes: this.data?.importGraph?.nodes?.length,
            callNodes: this.data?.callGraph?.nodes?.length,
            callGraphAvailable,
            worktree: this.worktree?.name
        });

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
    onState({ currentView, graphType, selectedPath, selectedType, selectionSource }: AppState) {
        const canvasEl = this.el.querySelector('.graph-canvas') as HTMLElement;

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

    /**
     * Handle node click from graph.
     */
    private handleNodeClick(nodeId: string): void {
        let filePath = nodeId;
        const hashIndex = nodeId.lastIndexOf('#');
        if (hashIndex > 0) {
            filePath = nodeId.substring(0, hashIndex);
        }

        this.state.set({
            selectedPath: filePath,
            selectedType: 'file',
            selectionSource: 'graph'
        });
    }

    /**
     * Handle folder click from graph.
     */
    private handleFolderClick(folderPath: string): void {
        this.state.set({
            selectedPath: folderPath,
            selectedType: 'directory',
            selectionSource: 'graph'
        });
    }

    /**
     * Handle file click from graph.
     */
    private handleFileClick(filePath: string): void {
        this.state.set({
            selectedPath: filePath,
            selectedType: 'file',
            selectionSource: 'graph'
        });
    }

    /**
     * Handle theme changes.
     */
    private handleThemeChange = () => {
        // SVG elements use CSS variables so they should update automatically
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

    // --- Worktree helpers ---

    getNode(path: string): WorkTreeNode | undefined {
        if (!this.worktree) return undefined;
        return this.findNode(this.worktree, path);
    }

    private findNode(node: WorkTreeNode, path: string): WorkTreeNode | undefined {
        if (node.path === path) return node;
        if (node.type === 'directory' && (node as DirectoryNode).children) {
            for (const child of (node as DirectoryNode).children) {
                const found = this.findNode(child, path);
                if (found) return found;
            }
        }
        return undefined;
    }

    collectSubtreeFiles(dirNode: WorkTreeNode): Set<string> {
        const files = new Set<string>();
        const walk = (node: WorkTreeNode) => {
            if (!node) return;
            if (node.type === "file") {
                files.add(node.path);
            } else if (node.type === "directory" && (node as DirectoryNode).children) {
                (node as DirectoryNode).children.forEach(walk);
            }
        };
        walk(dirNode);
        return files;
    }

    // --- Resize Handling ---
    private resizeObserver: ResizeObserver | null = null;
    private resizeTimeout: any = null;

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

            console.log('[GraphView] handleResize:', { width, height, time: Date.now() });

            if (this.graphRenderer) {
                this.graphRenderer.resize(width, height);
                if (this.data && this.worktree) {
                    const graph = this.currentGraphType === "import"
                        ? this.data.importGraph
                        : this.data.callGraph;
                    this.graphRenderer.render(graph, this.worktree, this.currentGraphType as any);
                }
            } else {
                console.log('[GraphView] Resize triggered but no renderer yet');
            }
        }, 100);
    }
}
