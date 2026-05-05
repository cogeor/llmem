/**
 * Hierarchical Layout Engine
 *
 * Two-pass layout:
 * 1. Compute sizes bottom-up
 * 2. Arrange boxes using shelf packing (sort by height, fill rows)
 *
 * Loop 16: per-pass measurement state lives in `this.measured`
 * (typed `Map<string, MeasuredNode>` keyed by `VisNode.id`) instead
 * of untyped scratch-field mutations on the input nodes. The input
 * `VisNode[]` is read-only.
 */

import { VisNode, VisEdge, WorkTreeNode } from '../types';
import { FolderRegion, FileRegion, LayoutResult } from './graphTypes';
import { MeasuredNode, FolderBlock } from './layout-types';
import {
    getLabelLength,
    groupNodesByFile,
    layoutFileBlock,
    packFileBlocks,
    simulateShelfPack,
} from './layout-pack';
import {
    FolderNode,
    buildFolderTree,
    ensureFolder,
    findFolder,
    findParent,
} from './folder-tree';
import { WebviewLogger, createWebviewLogger } from '../services/webview-logger';

const PADDING = 12;
const LABEL_HEIGHT = 16;
const NODE_SPACING = 40;
const FOLDER_GAP = 20;
const FILE_PADDING = 0;

export class HierarchicalLayout {
    private width: number;
    private height: number;
    private logger: WebviewLogger;

    // Persistent layout state for incremental updates
    private folderTree: FolderNode | null = null;

    /**
     * Per-pass measurement state, keyed by `VisNode.id`. Replaces the
     * pre-loop-16 untyped scratch-field smuggling on the input nodes.
     * `compute()` resets the map on entry; `addNodes()` does NOT reset
     * (the incremental path keeps prior measurements for unchanged
     * nodes).
     */
    private measured: Map<string, MeasuredNode> = new Map();

    /** Loop 14: `logger` optional; default silent for log/debug. */
    constructor(width: number, height: number, logger?: WebviewLogger) {
        this.width = width;
        this.height = height;
        this.logger = logger ?? createWebviewLogger({ enabled: false });
    }

    /** Get-or-create the `MeasuredNode` for a given `VisNode.id`. */
    private getMeasured(id: string): MeasuredNode {
        let m = this.measured.get(id);
        if (!m) {
            m = {
                id,
                localX: 0, localY: 0,
                relX: 0, relY: 0,
                x: 0, y: 0,
                finalized: false,
            };
            this.measured.set(id, m);
        }
        return m;
    }

    compute(
        nodes: VisNode[],
        edges: VisEdge[],
        worktree: WorkTreeNode
    ): LayoutResult {
        // Reset per-pass measurement state.
        this.measured.clear();
        this.folderTree = buildFolderTree(nodes);

        // 1. Position nodes (relative). 2. Compute folder sizes from
        // positions. 3. Shelf-pack folders. 4. Finalize abs positions.
        this.computeNodePositionsRelative(this.folderTree);
        this.computeFolderSizes(this.folderTree, /* recurse */ true);

        // FORCE ROOT WIDTH: root folder fills the container.
        this.folderTree.width = Math.max(this.folderTree.width, this.width - PADDING * 2);
        this.arrangeFolders(this.folderTree, PADDING, PADDING);
        this.finalizeNodePositions(this.folderTree);

        const nodePositions = new Map<string, { x: number; y: number }>();
        const folders: FolderRegion[] = [];
        const fileRegions: FileRegion[] = [];
        this.extractResults(this.folderTree, nodePositions, folders, fileRegions);

        // Diagnostic: missing positions. (Loop 14: no sample dump.)
        let missing = 0;
        for (const node of nodes) if (!nodePositions.has(node.id)) missing++;
        if (missing > 0) {
            this.logger.warn(`[HierarchicalLayout] ${missing} nodes have no position!`);
        }
        this.logger.log(`[HierarchicalLayout] Computed ${nodePositions.size}/${nodes.length} positions`);

        return { folders, fileRegions, nodePositions };
    }

    /**
     * Step 1: Position nodes relative to folder origin (0, 0) with
     * dynamic spacing. Stores results in `this.measured` (keyed by
     * `VisNode.id`).
     */
    private computeNodePositionsRelative(folder: FolderNode): void {
        for (const child of folder.children.values()) {
            this.computeNodePositionsRelative(child);
        }
        if (folder.nodes.length === 0) return;

        const nodesByFile = groupNodesByFile(folder.nodes);
        const fileBlocks: FolderBlock[] = [];
        let totalFileArea = 0;

        for (const [filePath, fileNodes] of nodesByFile) {
            const { width, height } = layoutFileBlock(fileNodes, (node, x, y) => {
                const m = this.getMeasured(node.id);
                m.localX = x;
                m.localY = y;
            });
            fileBlocks.push({ path: filePath, nodes: fileNodes, width, height, x: 0, y: 0 });
            totalFileArea += width * height;
        }

        packFileBlocks(fileBlocks, totalFileArea);

        // Apply final relative positions (block offset + local offset)
        for (const block of fileBlocks) {
            for (const node of block.nodes) {
                const m = this.getMeasured(node.id);
                m.relX = block.x + m.localX;
                m.relY = block.y + m.localY;
            }
        }
    }

    /**
     * Compute folder size (and optionally recurse). Replaces the
     * pre-loop-16 duplicate pair `computeSizesFromPositions` (with
     * recursion) and `computeSingleFolderSize` (without). Both call
     * sites collapse to this single helper.
     */
    private computeFolderSizes(folder: FolderNode, recurse: boolean): void {
        if (recurse) {
            for (const child of folder.children.values()) {
                this.computeFolderSizes(child, true);
            }
        }

        // Compute exact node grid size from actual positions
        let nodeGridWidth = 0;
        let nodeGridHeight = 0;

        if (folder.nodes.length > 0) {
            let maxX = 0;
            let maxY = 0;
            for (const node of folder.nodes) {
                const m = this.getMeasured(node.id);
                const labelLen = getLabelLength(node);
                const labelPadding = Math.max(20, labelLen * 4);
                maxX = Math.max(maxX, m.relX + labelPadding);
                maxY = Math.max(maxY, m.relY + NODE_SPACING / 2 + 10);
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

            let totalChildArea = 0;
            for (const child of childArray) totalChildArea += child.width * child.height;

            const targetSquareWidth = Math.sqrt(totalChildArea * 1.1);
            const maxRowWidth = Math.max(300, targetSquareWidth, nodeGridWidth + PADDING * 2);
            const sim = simulateShelfPack(childArray, maxRowWidth, FOLDER_GAP);
            childrenWidth = sim.width;
            childrenHeight = sim.height;
        }

        folder.contentWidth = Math.max(nodeGridWidth, childrenWidth);
        folder.contentHeight = childrenHeight + (childrenHeight > 0 && nodeGridHeight > 0 ? FOLDER_GAP : 0) + nodeGridHeight;
        folder.width = Math.max(folder.contentWidth + PADDING * 2, 60);
        folder.height = Math.max(LABEL_HEIGHT + folder.contentHeight + PADDING * 2, 40);
    }

    /**
     * Shelf-pack `parent.children` into the parent's content box,
     * calling `place(child, x, y)` once per child at its assigned
     * position. Used by both `arrangeFolders` (recursive arrangement)
     * and `rearrangeSiblings` (siblings only, after an incremental
     * add). Sorts children by descending height — same as before.
     */
    private shelfPackChildren(
        parent: FolderNode,
        place: (child: FolderNode, x: number, y: number) => void,
    ): void {
        if (parent.children.size === 0) return;

        const contentX = parent.x + PADDING;
        const contentY = parent.y + LABEL_HEIGHT + PADDING;
        const rightEdge = parent.x + parent.width - PADDING;

        const childArray = Array.from(parent.children.values());
        childArray.sort((a, b) => b.height - a.height);

        let rowX = contentX;
        let rowY = contentY;
        let rowHeight = 0;

        for (const child of childArray) {
            if (rowX > contentX && rowX + child.width > rightEdge) {
                rowY += rowHeight + FOLDER_GAP;
                rowX = contentX;
                rowHeight = 0;
            }
            place(child, rowX, rowY);
            rowX += child.width + FOLDER_GAP;
            rowHeight = Math.max(rowHeight, child.height);
        }
    }

    /** Step 3: Arrange folders using shelf packing. */
    private arrangeFolders(folder: FolderNode, x: number, y: number): void {
        folder.x = x;
        folder.y = y;
        this.shelfPackChildren(folder, (child, cx, cy) => {
            this.arrangeFolders(child, cx, cy);
        });
    }

    /**
     * Step 4: Convert relative node positions to absolute, marking each
     * visited node `finalized: true` so `extractResults` can tell a
     * legitimately-positioned-at-origin node from one missed by an
     * earlier pass.
     */
    private finalizeNodePositions(folder: FolderNode): void {
        const contentX = folder.x + PADDING;
        const contentY = folder.y + LABEL_HEIGHT + PADDING;
        const childrenHeight = this.getChildrenHeight(folder);
        const nodeOffsetY = contentY + childrenHeight + (childrenHeight > 0 ? FOLDER_GAP : 0);

        for (const node of folder.nodes) {
            const m = this.getMeasured(node.id);
            m.x = contentX + m.relX;
            m.y = nodeOffsetY + m.relY;
            m.finalized = true;
        }

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
        if (folder.path) {
            folders.push({
                path: folder.path, label: folder.name,
                x0: folder.x, y0: folder.y,
                x1: folder.x + folder.width, y1: folder.y + folder.height,
                depth: folder.depth, nodeCount: folder.nodes.length,
                children: [],
            });
        }

        // File regions: bucket by file then build a region per file.
        const nodesByFile = groupNodesByFile(folder.nodes);
        for (const [filePath, fileNodes] of nodesByFile) {
            const positions: { x: number; y: number }[] = [];
            for (const node of fileNodes) {
                const m = this.measured.get(node.id);
                if (m && m.finalized) positions.push({ x: m.x, y: m.y });
            }
            if (positions.length === 0) continue;

            const minX = Math.min(...positions.map(p => p.x)) - 15;
            const maxX = Math.max(...positions.map(p => p.x)) + 15;
            const minY = Math.min(...positions.map(p => p.y)) - 12;
            const maxY = Math.max(...positions.map(p => p.y)) + 18;
            const fileName = filePath.split('/').pop() || filePath;
            fileRegions.push({
                path: filePath, label: fileName,
                x0: minX, y0: minY, x1: maxX, y1: maxY,
                nodeCount: fileNodes.length,
            });
        }

        // Node positions: keep original folder.nodes iteration order
        // so the resulting Map's insertion order is identical to the
        // pre-loop-16 output.
        for (const node of folder.nodes) {
            const m = this.measured.get(node.id);
            if (m && m.finalized) nodePositions.set(node.id, { x: m.x, y: m.y });
        }

        for (const child of folder.children.values()) {
            this.extractResults(child, nodePositions, folders, fileRegions);
        }
    }

    // ========================================================================
    // Incremental Layout Methods
    // ========================================================================

    /**
     * Add nodes to a specific folder incrementally. Re-layouts the
     * affected folder and its ancestors. Does NOT reset
     * `this.measured` — prior measurements for unchanged nodes survive.
     */
    addNodes(newNodes: VisNode[], targetFolderPath: string): LayoutResult {
        if (!this.folderTree) {
            throw new Error('Must call compute() before addNodes()');
        }

        const targetFolder = findFolder(this.folderTree, targetFolderPath);
        if (!targetFolder) {
            const folder = ensureFolder(this.folderTree, targetFolderPath);
            folder.nodes.push(...newNodes);
        } else {
            const existingIds = new Set(targetFolder.nodes.map(n => n.id));
            const uniqueNewNodes = newNodes.filter(n => !existingIds.has(n.id));
            targetFolder.nodes.push(...uniqueNewNodes);
        }

        const folder = targetFolder || findFolder(this.folderTree, targetFolderPath)!;

        this.computeNodePositionsRelative(folder);
        this.recomputeSizesUpward(folder);
        this.rearrangeSiblings(folder);
        this.finalizeNodePositions(this.folderTree);

        const nodePositions = new Map<string, { x: number; y: number }>();
        const folders: FolderRegion[] = [];
        const fileRegions: FileRegion[] = [];
        this.extractResults(this.folderTree, nodePositions, folders, fileRegions);

        this.logger.log(`[HierarchicalLayout] Incremental add: ${newNodes.length} nodes to ${targetFolderPath}`);
        return { folders, fileRegions, nodePositions };
    }

    /** Recompute sizes from a folder up to root. */
    private recomputeSizesUpward(folder: FolderNode): void {
        this.computeFolderSizes(folder, /* recurse */ false);
        if (!this.folderTree) return;
        const parent = findParent(this.folderTree, folder);
        if (parent) this.recomputeSizesUpward(parent);
    }

    /** Re-arrange siblings when a folder's size changes. */
    private rearrangeSiblings(changedFolder: FolderNode): void {
        if (!this.folderTree) return;
        const parent = findParent(this.folderTree, changedFolder);
        if (!parent) return; // Root folder, no siblings
        this.shelfPackChildren(parent, (child, cx, cy) => {
            this.arrangeFolders(child, cx, cy);
        });
    }
}
