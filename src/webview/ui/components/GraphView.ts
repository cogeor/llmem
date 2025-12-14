
import { filterOneHopFromNode, filterFolderScope, filterFileScope } from "../graph/GraphFilter";
import { GraphDataService } from "../services/graphDataService";
import { WorktreeService } from "../services/worktreeService";
import { GraphRendererAdapter } from "../graph/GraphRendererAdapter";
import { AppState, GraphData } from "../types";

interface Props {
    el: HTMLElement;
    state: any;
    graphDataService: GraphDataService;
    worktreeService: WorktreeService;
    graphRenderer: GraphRendererAdapter;
}

interface GraphParams {
    selectedPath: string | null;
    selectedType: string | null;
    graphType: string;
}

export class GraphView {
    public el: HTMLElement;
    private state: any;
    private graphDataService: GraphDataService;
    private worktreeService: WorktreeService;
    private graphRenderer: GraphRendererAdapter;
    private data: GraphData | null = null;
    private unsubscribe?: () => void;
    private lastParams?: GraphParams;

    constructor({ el, state, graphDataService, worktreeService, graphRenderer }: Props) {
        this.el = el;
        this.state = state;
        this.graphDataService = graphDataService;
        this.worktreeService = worktreeService;
        this.graphRenderer = graphRenderer;
    }

    async mount() {
        this.data = await this.graphDataService.load();
        this.unsubscribe = this.state.subscribe((s: AppState) => this.onState(s));

        // Listen for theme changes to redraw graph with new colors
        window.addEventListener('theme-changed', this.handleThemeChange);
    }

    private handleThemeChange = () => {
        // Re-render if graph is visible
        if (this.el.querySelector('.graph-canvas')?.getAttribute('style')?.includes('block')) {
            // Force re-render with current state
            if (this.graphRenderer && this.data) {
                // We need to re-call render to pick up new colors
                // Simplest way is re-triggering onState or just calling renderer directly if we tracked params
                // Since onState checks for changes, we might need to invalidate lastParams or just call renderer
                this.graphRenderer.render(this.graphRenderer.currentData, {
                    selectedId: this.state.get().selectedType === "file" ? this.state.get().selectedPath : null
                });
            }
        }
    };

    onState({ currentView, graphType, selectedPath, selectedType }: AppState) {
        if (currentView !== "graph") {
            return;
        }

        const msgEl = this.el.querySelector('.graph-message') as HTMLElement;
        const canvasEl = this.el.querySelector('.graph-canvas') as HTMLElement;

        if (!selectedPath) {
            msgEl.style.display = 'flex';
            canvasEl.style.display = 'none';
            return;
        }

        msgEl.style.display = 'none';
        canvasEl.style.display = 'block';

        if (this.graphRenderer.container !== canvasEl) {
            this.graphRenderer.container = canvasEl;
            this.graphRenderer.network = null;
        }

        const newParams = { selectedPath, selectedType, graphType };
        const paramsChanged = !this.lastParams ||
            this.lastParams.selectedPath !== selectedPath ||
            this.lastParams.selectedType !== selectedType ||
            this.lastParams.graphType !== graphType;

        if (!paramsChanged) {
            if (this.graphRenderer.network) {
                this.graphRenderer.network.redraw();
            }
            return;
        }
        this.lastParams = newParams;

        // Ensure data is loaded
        if (!this.data) return;

        const graph = graphType === "import"
            ? this.data.importGraph
            : this.data.callGraph;

        let filtered;

        if (selectedType === "file") {
            if (graphType === "call") {
                filtered = filterFileScope(graph, selectedPath);
            } else {
                filtered = filterOneHopFromNode(graph, selectedPath);
            }
        } else {
            const dirNode = this.worktreeService.getNode(selectedPath);
            if (dirNode) {
                const subtreeFiles = this.worktreeService.collectSubtreeFiles(dirNode);
                filtered = filterFolderScope(graph, subtreeFiles);
            } else {
                filtered = { nodes: [], edges: [] };
            }
        }

        let baseDir = selectedPath;

        if (selectedPath && (selectedPath.startsWith('/') || selectedPath.match(/^[a-zA-Z]:/))) {
            const srcIndex = selectedPath.indexOf('src/');
            if (srcIndex !== -1) {
                baseDir = selectedPath.substring(srcIndex);
            }
        }

        if (selectedType === 'file' && baseDir) {
            const lastSlash = baseDir.lastIndexOf('/');
            const lastBackSlash = baseDir.lastIndexOf('\\');
            const sep = Math.max(lastSlash, lastBackSlash);
            if (sep >= 0) {
                baseDir = baseDir.substring(0, sep);
            } else {
                baseDir = "";
            }
        }

        const relativeNodes = filtered.nodes.map(n => {
            let label = n.label || n.id;
            label = this.computeDisplayedName(label, baseDir);
            return { ...n, label };
        });

        this.graphRenderer.render({ nodes: relativeNodes, edges: filtered.edges }, {
            selectedId: selectedType === "file" ? selectedPath : null
        });
    }

    computeDisplayedName(nodeLabel: string, currentPath: string | null): string {
        if (!currentPath) return nodeLabel;

        const normLabel = nodeLabel.replace(/\\/g, '/');
        const normPath = currentPath.replace(/\\/g, '/');

        let filePath = normLabel;
        let suffix = "";

        const colonIndex = normLabel.lastIndexOf(':');
        if (colonIndex !== -1) {
            filePath = normLabel.substring(0, colonIndex);
            suffix = normLabel.substring(colonIndex);
        }

        const relative = this.getRelativePath(normPath, filePath);
        return relative + suffix;
    }

    getRelativePath(from: string, to: string): string {
        const normalize = (p: string) => p ? p.replace(/\\/g, '/').split('/').filter(x => x.length > 0) : [];
        const fromParts = normalize(from);
        const toParts = normalize(to);

        let i = 0;
        // Case-insensitive comparison
        while (i < fromParts.length && i < toParts.length &&
            fromParts[i].toLowerCase() === toParts[i].toLowerCase()) {
            i++;
        }

        const upMoves = fromParts.length - i;
        const downMoves = toParts.slice(i);

        let result = "";
        if (upMoves > 0) {
            result += "../".repeat(upMoves);
        }

        if (downMoves.length > 0) {
            result += downMoves.join('/');
        } else if (upMoves === 0) {
            const lastPart = toParts[toParts.length - 1];
            return lastPart;
        }

        return result;
    }

    unmount() {
        this.unsubscribe?.();
        window.removeEventListener('theme-changed', this.handleThemeChange);
    }
}
