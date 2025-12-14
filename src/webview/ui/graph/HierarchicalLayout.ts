/**
 * Hierarchical Layout Engine
 * 
 * Two-pass layout:
 * 1. Compute sizes bottom-up
 * 2. Arrange boxes using shelf packing (sort by height, fill rows)
 */

import { VisNode, VisEdge, WorkTreeNode, DirectoryNode } from '../types';
import { FolderRegion, FileRegion, LayoutResult } from './graphTypes';

const PADDING = 12;
const LABEL_HEIGHT = 16;
const NODE_SPACING = 40;           // Base spacing between nodes
const MIN_NODE_SPACING = 35;       // Minimum spacing
const CHAR_SPACING_FACTOR = 6;     // Extra pixels per character
const FOLDER_GAP = 20;             // Gap between children and parent nodes
const FILE_PADDING = 0;            // No extra padding - handled by label spacing

function normalizePath(p: string): string {
    return p.replace(/\\/g, '/');
}

function getNodeFolderPath(node: VisNode): string {
    const path = normalizePath(node.fileId || node.id);
    const lastSlash = path.lastIndexOf('/');
    return lastSlash > 0 ? path.substring(0, lastSlash) : '';
}

interface FolderNode {
    path: string;
    name: string;
    depth: number;
    children: Map<string, FolderNode>;
    nodes: VisNode[];
    // Computed sizes
    contentWidth: number;
    contentHeight: number;
    width: number;
    height: number;
    // Final positions
    x: number;
    y: number;
}

export class HierarchicalLayout {
    private width: number;
    private height: number;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
    }

    compute(
        nodes: VisNode[],
        edges: VisEdge[],
        worktree: WorkTreeNode
    ): LayoutResult {
        // Build folder tree
        const root = this.buildFolderTree(nodes);

        // NEW FLOW:
        // 1. Position nodes FIRST (relative to folder origin) with dynamic spacing
        // 2. Compute exact folder sizes from actual node positions
        // 3. Arrange folders using shelf packing
        // 4. Finalize node positions (convert relative to absolute)

        // Step 1: Position nodes relative to (0, 0) for each folder
        this.computeNodePositionsRelative(root);

        // Step 2: Compute exact sizes from actual node positions (bottom-up)
        this.computeSizesFromPositions(root);

        // Step 3: Arrange folders using shelf packing

        // FORCE ROOT WIDTH: make the root folder fill the container
        root.width = Math.max(root.width, this.width - PADDING * 2);

        this.arrangeFolders(root, PADDING, PADDING, this.width - PADDING * 2);

        // Step 4: Finalize node positions (add folder offset)
        this.finalizeNodePositions(root);

        // Extract results
        const nodePositions = new Map<string, { x: number; y: number }>();
        const folders: FolderRegion[] = [];
        const fileRegions: FileRegion[] = [];
        this.extractResults(root, nodePositions, folders, fileRegions);

        return { folders, fileRegions, nodePositions };
    }

    private buildFolderTree(nodes: VisNode[]): FolderNode {
        const root: FolderNode = {
            path: '',
            name: 'root',
            depth: 0,
            children: new Map(),
            nodes: [],
            contentWidth: 0, contentHeight: 0,
            width: 0, height: 0,
            x: 0, y: 0
        };

        for (const node of nodes) {
            const folderPath = getNodeFolderPath(node);
            const folder = this.ensureFolder(root, folderPath);
            folder.nodes.push(node);
        }

        return root;
    }

    private ensureFolder(root: FolderNode, path: string): FolderNode {
        if (!path) return root;

        const parts = path.split('/').filter(p => p.length > 0);
        let current = root;
        let currentPath = '';

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            currentPath = currentPath ? `${currentPath}/${part}` : part;

            if (!current.children.has(part)) {
                current.children.set(part, {
                    path: currentPath,
                    name: part,
                    depth: i + 1,
                    children: new Map(),
                    nodes: [],
                    contentWidth: 0, contentHeight: 0,
                    width: 0, height: 0,
                    x: 0, y: 0
                });
            }
            current = current.children.get(part)!;
        }

        return current;
    }

    /**
     * Helper to get label length for spacing calculation.
     */
    private getLabelLength(node: VisNode): number {
        const label = node.label || node.id;
        const parts = label.split(/[\/\\#:]/);
        return (parts[parts.length - 1] || label).length;
    }

    /**
     * Step 1: Position nodes relative to folder origin (0, 0) with dynamic spacing.
     * Stores positions in node._relX and node._relY
     */
    private computeNodePositionsRelative(folder: FolderNode): void {
        // First process children recursively
        for (const child of folder.children.values()) {
            this.computeNodePositionsRelative(child);
        }

        if (folder.nodes.length === 0) return;

        // Group nodes by file
        const nodesByFile = new Map<string, VisNode[]>();
        for (const node of folder.nodes) {
            const filePath = normalizePath(node.fileId || node.id);
            if (!nodesByFile.has(filePath)) {
                nodesByFile.set(filePath, []);
            }
            nodesByFile.get(filePath)!.push(node);
        }

        // Position each file's nodes relative to (0, 0)
        let fileStartX = FILE_PADDING;
        for (const [_filePath, fileNodes] of nodesByFile) {
            const cols = Math.ceil(Math.sqrt(fileNodes.length));

            // Group nodes by row
            const nodeRows: VisNode[][] = [];
            for (let i = 0; i < fileNodes.length; i++) {
                const row = Math.floor(i / cols);
                if (!nodeRows[row]) nodeRows[row] = [];
                nodeRows[row].push(fileNodes[i]);
            }

            // Position nodes with dynamic X spacing
            let currentY = FILE_PADDING;
            let maxRowEndX = fileStartX;  // Track where the rightmost node ends (including label)

            for (const rowNodes of nodeRows) {
                let currentX = fileStartX;
                for (let i = 0; i < rowNodes.length; i++) {
                    const node = rowNodes[i];
                    const labelLen = this.getLabelLength(node);

                    // Average with neighbor if exists
                    let avgLen = labelLen;
                    if (i > 0) {
                        const prevLen = this.getLabelLength(rowNodes[i - 1]);
                        avgLen = (labelLen + prevLen) / 2;
                    }

                    const dynamicSpacing = Math.max(
                        MIN_NODE_SPACING,
                        NODE_SPACING + (avgLen - 10) * CHAR_SPACING_FACTOR
                    );

                    (node as any)._relX = currentX + dynamicSpacing / 2;
                    (node as any)._relY = currentY;

                    currentX += dynamicSpacing;

                    // Track rightmost extent including label (4px per char)
                    const labelPadding = Math.max(20, labelLen * 4);
                    maxRowEndX = Math.max(maxRowEndX, (node as any)._relX + labelPadding);
                }
                currentY += NODE_SPACING;
            }

            // Move to next file's position with proper gap
            fileStartX = maxRowEndX + FOLDER_GAP + FILE_PADDING;
        }
    }

    /**
     * Step 2: Compute exact folder sizes from actual node positions (bottom-up).
     */
    private computeSizesFromPositions(folder: FolderNode): void {
        // First compute children sizes recursively
        for (const child of folder.children.values()) {
            this.computeSizesFromPositions(child);
        }

        // Compute exact node grid size from actual positions
        let nodeGridWidth = 0;
        let nodeGridHeight = 0;

        if (folder.nodes.length > 0) {
            let maxX = 0;
            let maxY = 0;
            for (const node of folder.nodes) {
                const relX = (node as any)._relX || 0;
                const relY = (node as any)._relY || 0;
                // Add extra space for label (approx 4px per char)
                const labelLen = this.getLabelLength(node);
                const labelPadding = Math.max(20, labelLen * 4);
                maxX = Math.max(maxX, relX + labelPadding);
                maxY = Math.max(maxY, relY + NODE_SPACING / 2 + 10); // Space below node
            }
            nodeGridWidth = maxX + FILE_PADDING;
            nodeGridHeight = maxY + FILE_PADDING;
        }

        // Compute children layout size using shelf packing simulation
        let childrenWidth = 0;
        let childrenHeight = 0;

        if (folder.children.size > 0) {
            const childArray = Array.from(folder.children.values());
            childArray.sort((a, b) => b.height - a.height);

            const maxRowWidth = Math.max(800, nodeGridWidth + PADDING * 2);
            let rowWidth = 0;
            let rowHeight = 0;
            let totalHeight = 0;
            let maxWidth = 0;

            for (const child of childArray) {
                if (rowWidth > 0 && rowWidth + child.width + FOLDER_GAP > maxRowWidth) {
                    totalHeight += rowHeight + FOLDER_GAP;
                    maxWidth = Math.max(maxWidth, rowWidth);
                    rowWidth = 0;
                    rowHeight = 0;
                }
                rowWidth += child.width + (rowWidth > 0 ? FOLDER_GAP : 0);
                rowHeight = Math.max(rowHeight, child.height);
            }
            totalHeight += rowHeight;
            maxWidth = Math.max(maxWidth, rowWidth);

            childrenWidth = maxWidth;
            childrenHeight = totalHeight;
        }

        // Total content size
        folder.contentWidth = Math.max(nodeGridWidth, childrenWidth);
        folder.contentHeight = childrenHeight + (childrenHeight > 0 && nodeGridHeight > 0 ? FOLDER_GAP : 0) + nodeGridHeight;

        // Folder size with padding
        folder.width = folder.contentWidth + PADDING * 2;
        folder.height = LABEL_HEIGHT + folder.contentHeight + PADDING * 2;

        // Minimum size
        folder.width = Math.max(folder.width, 60);
        folder.height = Math.max(folder.height, 40);

        // ROOT ADJUSTMENT:
        // If this is the root folder (empty path or depth 0), force it to take the full container width
        // This ensures the "src box" matches the pane size and binning fills it.
        // We do this by artificially setting the width, which the arrange step will respect.
        // Note: arrangeFolders uses 'maxWidth' arg, but we want the root BOX itself to be wide.
        if (folder.depth === 0) {
            // Available width minus safety/margin
            // The container width is passed to the constructor and resize()
            // layout.width is available here via this.width? No, this is a recursive function.
            // We need to access the class property, but 'this' is available.
        }
    }

    /**
     * Step 3: Arrange folders using shelf packing (no node positioning - that's already done).
     */
    private arrangeFolders(folder: FolderNode, x: number, y: number, maxWidth: number): void {
        folder.x = x;
        folder.y = y;

        const contentX = x + PADDING;
        const contentY = y + LABEL_HEIGHT + PADDING;

        // Arrange child folders using shelf packing
        if (folder.children.size > 0) {
            const childArray = Array.from(folder.children.values());
            childArray.sort((a, b) => b.height - a.height);

            let rowX = contentX;
            let rowY = contentY;
            let rowHeight = 0;

            for (const child of childArray) {
                if (rowX > contentX && rowX + child.width > x + folder.width - PADDING) {
                    rowY += rowHeight + FOLDER_GAP;
                    rowX = contentX;
                    rowHeight = 0;
                }

                this.arrangeFolders(child, rowX, rowY, child.width);
                rowX += child.width + FOLDER_GAP;
                rowHeight = Math.max(rowHeight, child.height);
            }
        }
    }

    /**
     * Step 4: Convert relative node positions to absolute (add folder offsets).
     */
    private finalizeNodePositions(folder: FolderNode): void {
        // Calculate where nodes start in the folder (after children)
        const contentX = folder.x + PADDING;
        const contentY = folder.y + LABEL_HEIGHT + PADDING;
        const childrenHeight = this.getChildrenHeight(folder);
        const nodeOffsetY = contentY + childrenHeight + (childrenHeight > 0 ? FOLDER_GAP : 0);

        // Convert relative positions to absolute
        for (const node of folder.nodes) {
            const relX = (node as any)._relX || 0;
            const relY = (node as any)._relY || 0;
            (node as any)._x = contentX + relX;
            (node as any)._y = nodeOffsetY + relY;
        }

        // Recurse to children
        for (const child of folder.children.values()) {
            this.finalizeNodePositions(child);
        }
    }

    private getChildrenHeight(folder: FolderNode): number {
        if (folder.children.size === 0) return 0;

        let maxY = 0;
        for (const child of folder.children.values()) {
            maxY = Math.max(maxY, child.y + child.height - folder.y - LABEL_HEIGHT - PADDING);
        }
        return maxY;
    }

    private extractResults(
        folder: FolderNode,
        nodePositions: Map<string, { x: number; y: number }>,
        folders: FolderRegion[],
        fileRegions: FileRegion[]
    ): void {
        // Skip root folder
        if (folder.path) {
            folders.push({
                path: folder.path,
                label: folder.name,
                x0: folder.x,
                y0: folder.y,
                x1: folder.x + folder.width,
                y1: folder.y + folder.height,
                depth: folder.depth,
                nodeCount: folder.nodes.length,
                children: []
            });
        }

        // Group nodes by file and extract file regions
        const nodesByFile = new Map<string, VisNode[]>();
        for (const node of folder.nodes) {
            const filePath = normalizePath(node.fileId || node.id);
            if (!nodesByFile.has(filePath)) {
                nodesByFile.set(filePath, []);
            }
            nodesByFile.get(filePath)!.push(node);
        }

        // Create file regions based on node positions
        for (const [filePath, fileNodes] of nodesByFile) {
            const positions: { x: number; y: number }[] = [];
            for (const node of fileNodes) {
                const x = (node as any)._x;
                const y = (node as any)._y;
                if (x !== undefined && y !== undefined) {
                    positions.push({ x, y });
                }
            }

            if (positions.length > 0) {
                // Minimum padding to ensure single-node files are visible
                const minX = Math.min(...positions.map(p => p.x)) - 15;
                const maxX = Math.max(...positions.map(p => p.x)) + 15;
                const minY = Math.min(...positions.map(p => p.y)) - 12;
                const maxY = Math.max(...positions.map(p => p.y)) + 18;

                const fileName = filePath.split('/').pop() || filePath;
                fileRegions.push({
                    path: filePath,
                    label: fileName,
                    x0: minX,
                    y0: minY,
                    x1: maxX,
                    y1: maxY,
                    nodeCount: fileNodes.length
                });
            }
        }

        // Extract node positions
        for (const node of folder.nodes) {
            const x = (node as any)._x;
            const y = (node as any)._y;
            if (x !== undefined && y !== undefined) {
                nodePositions.set(node.id, { x, y });
            }
        }

        // Recurse
        for (const child of folder.children.values()) {
            this.extractResults(child, nodePositions, folders, fileRegions);
        }
    }
}
