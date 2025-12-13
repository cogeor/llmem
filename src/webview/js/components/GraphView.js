import { filterOneHopFromNode, filterFolderScope, filterFileScope } from "../graph/GraphFilter.js";

export class GraphView {
    constructor({ el, state, graphDataService, worktreeService, graphRenderer }) {
        this.el = el;
        this.state = state;
        this.graphDataService = graphDataService;
        this.worktreeService = worktreeService;
        this.graphRenderer = graphRenderer;
        this.data = null; // cached graph data
    }

    async mount() {
        this.data = await this.graphDataService.load();
        this.unsubscribe = this.state.subscribe((s) => this.onState(s));
    }

    onState({ currentView, graphType, selectedPath, selectedType }) {
        if (currentView !== "graph") {
            this.el.style.display = 'none';
            return;
        }
        this.el.style.display = 'block';

        const msgEl = this.el.querySelector('.graph-message');
        const canvasEl = this.el.querySelector('.graph-canvas');

        if (!selectedPath) {
            msgEl.style.display = 'flex';
            canvasEl.style.display = 'none';
            // clean up network if desired, or keep it hidden
            return;
        }

        msgEl.style.display = 'none';
        canvasEl.style.display = 'block'; // Ensure block display

        // We need to make sure the renderer is using the correct container.
        // In main.js we might have passed parent.
        // We ensure here:
        if (this.graphRenderer.container !== canvasEl) {
            this.graphRenderer.container = canvasEl;
            // Force re-creation of network because container changed
            this.graphRenderer.network = null;
        }

        const graph = graphType === "import"
            ? this.data.importGraph
            : this.data.callGraph;

        let filtered;

        if (selectedType === "file") {
            if (graphType === "call") {
                filtered = filterFileScope(graph, selectedPath);
            } else {
                filtered = filterOneHopFromNode(graph, selectedPath); // Works for Import Graph where NodeID = FilePath
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

        // Clone and Relativize Labels
        // Clone and Relativize Labels
        // Determine Base Directory for relative path calculation
        let baseDir = selectedPath;

        // Heuristic: If selectedPath looks absolute (starts with C:/ or /) and nodes use src/...
        // We try to convert baseDir to relative by matching with node IDs or finding common suffix.
        if (selectedPath && (selectedPath.startsWith('/') || selectedPath.match(/^[a-zA-Z]:/))) {
            // Try to find a node that ends with this path? No, path is longer.
            // Try to find if selectedPath ends with a node ID?
            // Graph nodes usually start with src/...
            // We can try to strip prefix until it starts with src/?
            const srcIndex = selectedPath.indexOf('src/');
            if (srcIndex !== -1) {
                baseDir = selectedPath.substring(srcIndex);
            }
        }

        if (selectedType === 'file' && baseDir) {
            // Strip filename to get directory
            const lastSlash = baseDir.lastIndexOf('/');
            const lastBackSlash = baseDir.lastIndexOf('\\'); // Handle windows raw path if present
            const sep = Math.max(lastSlash, lastBackSlash);
            if (sep >= 0) {
                baseDir = baseDir.substring(0, sep);
            } else {
                baseDir = ""; // Root?
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

    computeDisplayedName(nodeLabel, currentPath) {
        if (!currentPath) return nodeLabel;

        // Normalize
        const normLabel = nodeLabel.replace(/\\/g, '/');
        const normPath = currentPath.replace(/\\/g, '/');

        // Handle Call Graph labels which might be "path/to/file.ts:functionName"
        // We only want to relativize the file path part.
        let filePath = normLabel;
        let suffix = "";

        // Find the colon separator. 
        // Note: Windows paths shouldn't have colons here because we use fileId which is relative from root.
        const colonIndex = normLabel.lastIndexOf(':');
        if (colonIndex !== -1) {
            filePath = normLabel.substring(0, colonIndex);
            suffix = normLabel.substring(colonIndex);
        }

        const relative = this.getRelativePath(normPath, filePath);
        return relative + suffix;
    }

    getRelativePath(from, to) {
        // Normalize slashes and split
        const normalize = p => p ? p.replace(/\\/g, '/').split('/').filter(x => x.length > 0) : [];
        const fromParts = normalize(from);
        const toParts = normalize(to);

        let i = 0;
        // Case-insensitive comparison for Windows robustness
        while (i < fromParts.length && i < toParts.length &&
            fromParts[i].toLowerCase() === toParts[i].toLowerCase()) {
            i++;
        }

        const upMoves = fromParts.length - i;
        const downMoves = toParts.slice(i);

        // If we are deep inside and want to go out, we need ../
        // But if 'from' is empty (root), we just show the path.

        let result = "";
        if (upMoves > 0) {
            result += "../".repeat(upMoves);
        }

        if (downMoves.length > 0) {
            result += downMoves.join('/');
        } else if (upMoves === 0) {
            // Exact match (file selected)
            const lastPart = toParts[toParts.length - 1];
            return lastPart;
        }

        return result;
    }

    unmount() { this.unsubscribe?.(); }
}
