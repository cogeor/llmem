/**
 * Graph Renderer
 * 
 * Main orchestrator using plain SVG DOM manipulation.
 */

import { VisNode, VisEdge, WorkTreeNode } from '../types';
import { GraphRenderOptions, FolderRegion, FileRegion } from './graphTypes';
import { HierarchicalLayout } from './HierarchicalLayout';
import { GroupRenderer } from './GroupRenderer';
import { NodeRenderer } from './NodeRenderer';
import { EdgeRenderer } from './EdgeRenderer';
import { CameraController } from './CameraController';

export class GraphRenderer {
    private container: HTMLElement;
    private svg: SVGSVGElement;
    private mainGroup: SVGGElement;
    private foldersGroup: SVGGElement;
    private edgesGroup: SVGGElement;
    private nodesGroup: SVGGElement;

    private hierarchicalLayout: HierarchicalLayout;
    private groupRenderer: GroupRenderer;
    private nodeRenderer: NodeRenderer;
    private edgeRenderer: EdgeRenderer;
    private cameraController: CameraController;

    private width: number;
    private height: number;
    private onNodeClick?: (nodeId: string) => void;
    private onFolderClick?: (folderPath: string) => void;
    private onFileClick?: (filePath: string) => void;

    private currentEdges: VisEdge[] = [];
    private currentFileRegions: FileRegion[] = [];

    constructor(container: HTMLElement, options: GraphRenderOptions) {
        this.container = container;
        this.width = options.width || container.clientWidth || 1200;
        this.height = options.height || container.clientHeight || 800;
        this.onNodeClick = options.onNodeClick;
        this.onFolderClick = options.onFolderClick;
        this.onFileClick = options.onFileClick;

        // Create SVG
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.setAttribute('width', '100%');
        this.svg.setAttribute('height', '100%');
        this.svg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
        this.svg.setAttribute('class', 'd3-graph-svg');
        this.svg.style.background = 'var(--background)';

        container.appendChild(this.svg);

        // Create main group (for transforms)
        this.mainGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.mainGroup.setAttribute('class', 'main-group');
        this.mainGroup.style.transformOrigin = '0 0';
        this.svg.appendChild(this.mainGroup);

        // Create layer groups
        this.foldersGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.foldersGroup.setAttribute('class', 'folders-layer');
        this.mainGroup.appendChild(this.foldersGroup);

        this.edgesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.edgesGroup.setAttribute('class', 'edges-layer');
        this.mainGroup.appendChild(this.edgesGroup);

        this.nodesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.nodesGroup.setAttribute('class', 'nodes-layer');
        this.mainGroup.appendChild(this.nodesGroup);

        // Initialize components
        this.hierarchicalLayout = new HierarchicalLayout(this.width, this.height);
        this.groupRenderer = new GroupRenderer(this.foldersGroup);
        this.nodeRenderer = new NodeRenderer(this.nodesGroup);
        this.edgeRenderer = new EdgeRenderer(this.edgesGroup, this.svg);
        this.cameraController = new CameraController(this.svg, this.mainGroup, this.width, this.height);

        // Click on background clears selection (but not after a drag)
        this.svg.addEventListener('click', (e) => {
            if (e.target === this.svg && !this.cameraController.wasDrag()) {
                this.clearHighlight();
            }
        });
    }

    /**
     * Resize the graph and re-render if needed.
     */
    resize(width: number, height: number): void {
        this.width = width;
        this.height = height;

        this.svg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
        this.hierarchicalLayout = new HierarchicalLayout(this.width, this.height);
        this.cameraController.resize(this.width, this.height);

        // Note: Caller must call render() after resize to re-compute layout
    }

    /**
     * Render the graph.
     * @param graphType - 'import' or 'call' - file regions only shown for call graphs
     */
    render(
        graphData: { nodes: VisNode[]; edges: VisEdge[] },
        worktree: WorkTreeNode,
        graphType: 'import' | 'call' = 'import'
    ): void {
        const { nodes, edges } = graphData;
        this.currentEdges = edges;

        console.log('[GraphRenderer] Rendering:', { graphType, nodes: nodes.length, edges: edges.length });

        // 1. Compute layout
        const layoutResult = this.hierarchicalLayout.compute(nodes, edges, worktree);
        this.currentFileRegions = layoutResult.fileRegions;

        console.log('[GraphRenderer] Layout computed:', {
            folders: layoutResult.folders.length,
            fileRegions: layoutResult.fileRegions.length,
            positions: layoutResult.nodePositions.size
        });

        // 2. Update camera
        this.cameraController.setPositions(layoutResult.nodePositions, layoutResult.folders);

        // 3. Render folders and file groups (file groups only for call graphs)
        // Filter out the top-level container folder (usually 'src' or depth 1) if it's the only one
        // This makes the "src" box effectively the canvas background
        let foldersToRender = layoutResult.folders;
        const topLevelFolders = layoutResult.folders.filter(f => f.depth === 1);
        if (topLevelFolders.length === 1) {
            const topFolder = topLevelFolders[0];
            foldersToRender = layoutResult.folders.filter(f => f !== topFolder);
        }

        const fileRegionsToRender = graphType === 'call' ? layoutResult.fileRegions : undefined;
        this.groupRenderer.render(
            foldersToRender,
            this.handleFolderClick.bind(this),
            fileRegionsToRender,
            this.handleFileClick.bind(this)
        );

        // 4. Compute node colors (match containing folder)
        const nodeColors = this.computeNodeColors(nodes, layoutResult.folders);

        // 5. Render edges
        this.edgeRenderer.render(edges, layoutResult.nodePositions);

        // 6. Render nodes
        this.nodeRenderer.render(
            nodes,
            layoutResult.nodePositions,
            nodeColors,
            this.handleNodeClick.bind(this),
            undefined
        );

        // 7. Fit to view (width)
        // Calculate content bounds
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        // Use the full folder list for bounds calculation to ensure everything is visible
        if (layoutResult.folders.length > 0) {
            for (const f of layoutResult.folders) {
                minX = Math.min(minX, f.x0);
                minY = Math.min(minY, f.y0);
                maxX = Math.max(maxX, f.x1);
                maxY = Math.max(maxY, f.y1);
            }
        } else {
            // Fallback to nodes if no folders (unlikely)
            for (const pos of layoutResult.nodePositions.values()) {
                minX = Math.min(minX, pos.x);
                minY = Math.min(minY, pos.y);
                maxX = Math.max(maxX, pos.x + 200);
                maxY = Math.max(maxY, pos.y + 100);
            }
        }

        if (minX !== Infinity && maxX !== -Infinity) {
            const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

            // Update camera bounds
            this.cameraController.setBounds(bounds);

            this.cameraController.fitToWidth(bounds);
        } else {
            this.cameraController.fitAll(false);
        }
    }

    /**
     * Compute node colors based on containing folder.
     */
    private computeNodeColors(nodes: VisNode[], folders: FolderRegion[]): Map<string, string> {
        const colors = new Map<string, string>();

        for (const node of nodes) {
            const path = (node.fileId || node.id).replace(/\\/g, '/');
            const lastSlash = path.lastIndexOf('/');
            const folderPath = lastSlash > 0 ? path.substring(0, lastSlash) : '';

            const folder = folders.find(f => f.path === folderPath);
            if (folder) {
                colors.set(node.id, this.groupRenderer.getColorForPath(folder.path, folder.depth));
            }
        }

        return colors;
    }

    /**
     * Add nodes to a specific folder incrementally (lazy loading).
     * Uses incremental layout to avoid full recompute.
     */
    addNodesToFolder(
        newNodes: VisNode[],
        newEdges: VisEdge[],
        folderPath: string,
        worktree: WorkTreeNode,
        graphType: 'import' | 'call' = 'call'
    ): void {
        console.log(`[GraphRenderer] Adding ${newNodes.length} nodes to ${folderPath}`);

        // Merge edges
        this.currentEdges = [...this.currentEdges, ...newEdges];

        // Call incremental layout
        const layoutResult = this.hierarchicalLayout.addNodes(newNodes, folderPath);
        this.currentFileRegions = layoutResult.fileRegions;

        // Update camera bounds
        this.cameraController.setPositions(layoutResult.nodePositions, layoutResult.folders);

        // Re-render (full re-render for simplicity - can optimize later)
        let foldersToRender = layoutResult.folders;
        const topLevelFolders = layoutResult.folders.filter(f => f.depth === 1);
        if (topLevelFolders.length === 1) {
            const topFolder = topLevelFolders[0];
            foldersToRender = layoutResult.folders.filter(f => f !== topFolder);
        }

        const fileRegionsToRender = graphType === 'call' ? layoutResult.fileRegions : undefined;
        this.groupRenderer.render(
            foldersToRender,
            this.handleFolderClick.bind(this),
            fileRegionsToRender,
            this.handleFileClick.bind(this)
        );

        // Get all nodes from layout for color computation
        const allNodes = this.getAllNodesFromLayout(layoutResult.nodePositions);
        const nodeColors = this.computeNodeColors(allNodes, layoutResult.folders);

        this.edgeRenderer.render(this.currentEdges, layoutResult.nodePositions);
        this.nodeRenderer.render(
            allNodes,
            layoutResult.nodePositions,
            nodeColors,
            this.handleNodeClick.bind(this),
            undefined
        );

        // Update camera bounds
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const f of layoutResult.folders) {
            minX = Math.min(minX, f.x0);
            minY = Math.min(minY, f.y0);
            maxX = Math.max(maxX, f.x1);
            maxY = Math.max(maxY, f.y1);
        }

        if (minX !== Infinity && maxX !== -Infinity) {
            const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
            this.cameraController.setBounds(bounds);
        }

        console.log(`[GraphRenderer] Incremental update complete: ${layoutResult.nodePositions.size} total nodes`);
    }

    /**
     * Get all nodes from layout positions (for re-rendering after incremental update).
     */
    private getAllNodesFromLayout(nodePositions: Map<string, { x: number; y: number }>): VisNode[] {
        const nodes: VisNode[] = [];
        const nodeGroups = this.nodesGroup.querySelectorAll('.node-group');
        nodeGroups.forEach(g => {
            const id = g.getAttribute('data-id');
            const fileId = g.getAttribute('data-file-id');
            const label = g.querySelector('text')?.textContent;
            if (id && nodePositions.has(id)) {
                nodes.push({
                    id,
                    label: label || id,
                    group: '',
                    fileId: fileId || id
                });
            }
        });
        return nodes;
    }



    /**
     * Highlight neighbors.
     */
    highlightNeighbors(nodeId: string): void {
        const neighbors = this.edgeRenderer.getNeighbors(nodeId, this.currentEdges);
        this.nodeRenderer.highlightNode(nodeId, neighbors);
        this.edgeRenderer.highlightEdgesForNode(nodeId);
    }

    /**
     * Clear highlights.
     */
    clearHighlight(): void {
        this.nodeRenderer.clearHighlight();
        this.edgeRenderer.clearHighlight();
        this.groupRenderer.clearHighlight();
    }

    /**
     * Destroy.
     */
    destroy(): void {
        this.svg.remove();
    }

    private handleNodeClick(nodeId: string): void {
        // Only focus/highlight if it wasn't a drag
        if (!this.cameraController.wasDrag()) {
            this.highlightNeighbors(nodeId);
            this.onNodeClick?.(nodeId);
        }
    }

    private handleFolderClick(folderPath: string): void {
        // Only focus if it wasn't a drag
        if (!this.cameraController.wasDrag()) {
            this.highlightFolder(folderPath);
            this.onFolderClick?.(folderPath);
        }
    }

    private handleFileClick(filePath: string): void {
        // Only focus if it wasn't a drag
        if (!this.cameraController.wasDrag()) {
            this.highlightFile(filePath);
            this.onFileClick?.(filePath);
        }
    }

    /**
     * Highlight a folder and all its contained nodes, plus their direct neighbors.
     */
    highlightFolder(folderPath: string): void {
        this.clearHighlight();
        this.groupRenderer.highlightFolder(folderPath);

        // Get IDs of nodes in this folder
        const nodesInFolder = this.getNodesInFolder(folderPath);

        // Collect all direct neighbors
        const neighbors = new Set<string>();
        for (const nodeId of nodesInFolder) {
            const nodeNeighbors = this.edgeRenderer.getNeighbors(nodeId, this.currentEdges);
            for (const n of nodeNeighbors) {
                if (!nodesInFolder.has(n)) {
                    neighbors.add(n);
                }
            }
        }

        // Highlight nodes in folder and their neighbors
        this.nodeRenderer.highlightNodesInFolderWithNeighbors(folderPath, neighbors);

        // Highlight edges connected to nodes in folder
        this.edgeRenderer.highlightEdgesForNodes(nodesInFolder);
    }

    /**
     * Highlight a file and all its contained nodes, plus their direct neighbors.
     */
    highlightFile(filePath: string): void {
        this.clearHighlight();
        this.groupRenderer.highlightFile(filePath);

        // Get IDs of nodes in this file
        const nodesInFile = this.getNodesInFile(filePath);

        // Collect all direct neighbors
        const neighbors = new Set<string>();
        for (const nodeId of nodesInFile) {
            const nodeNeighbors = this.edgeRenderer.getNeighbors(nodeId, this.currentEdges);
            for (const n of nodeNeighbors) {
                if (!nodesInFile.has(n)) {
                    neighbors.add(n);
                }
            }
        }

        // Highlight nodes in file and their neighbors
        this.nodeRenderer.highlightNodesInFolderWithNeighbors(filePath, neighbors);

        // Highlight edges connected to nodes in file
        this.edgeRenderer.highlightEdgesForNodes(nodesInFile);
    }

    /**
     * Get all node IDs in a folder.
     */
    private getNodesInFolder(folderPath: string): Set<string> {
        const normalizedFolder = folderPath.replace(/\\/g, '/');
        const result = new Set<string>();

        const groups = this.nodesGroup.querySelectorAll('.node-group');
        groups.forEach(g => {
            const id = g.getAttribute('data-id') || '';
            const fileId = g.getAttribute('data-file-id') || id;
            const normalizedFileId = fileId.replace(/\\/g, '/');

            if (normalizedFileId.startsWith(normalizedFolder + '/') || normalizedFileId === normalizedFolder) {
                result.add(id);
            }
        });

        return result;
    }

    /**
     * Get all node IDs in a specific file.
     */
    private getNodesInFile(filePath: string): Set<string> {
        const normalizedFile = filePath.replace(/\\/g, '/');
        const result = new Set<string>();

        const groups = this.nodesGroup.querySelectorAll('.node-group');
        groups.forEach(g => {
            const id = g.getAttribute('data-id') || '';
            const fileId = g.getAttribute('data-file-id') || id;
            const normalizedFileId = fileId.replace(/\\/g, '/');

            // Exact match for file path
            if (normalizedFileId === normalizedFile) {
                result.add(id);
            }
        });

        return result;
    }
}
