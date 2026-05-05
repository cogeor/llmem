/**
 * Pure shelf-packing helpers used by `HierarchicalLayout`.
 *
 * Loop 16 — extracted from `HierarchicalLayout.ts` to keep that file
 * under the 400-line budget. These helpers operate on plain data and
 * do not touch the layout engine's state directly; the engine passes
 * them measured-position lookups via the `getNodePos` callback.
 */

import type { VisNode } from '../types';
import type { FolderBlock } from './layout-types';

const NODE_SPACING = 40;
const MIN_NODE_SPACING = 35;
const CHAR_SPACING_FACTOR = 6;
const FOLDER_GAP = 20;
const FILE_PADDING = 0;

function normalizePath(p: string): string {
    return p.replace(/\\/g, '/');
}

/** Extract the trailing label segment for a node (used for spacing). */
export function getLabelLength(node: VisNode): number {
    const label = node.label || node.id;
    const parts = label.split(/[/\\#:]/);
    return (parts[parts.length - 1] || label).length;
}

/** Group folder nodes by their normalized file path. */
export function groupNodesByFile(nodes: VisNode[]): Map<string, VisNode[]> {
    const grouped = new Map<string, VisNode[]>();
    for (const node of nodes) {
        const filePath = normalizePath(node.fileId || node.id);
        if (!grouped.has(filePath)) grouped.set(filePath, []);
        grouped.get(filePath)!.push(node);
    }
    return grouped;
}

/**
 * Per-file local layout: arrange `fileNodes` in a near-square grid,
 * writing each node's local coordinates via `setLocal(node, x, y)`.
 * Returns the resulting block width/height.
 */
export function layoutFileBlock(
    fileNodes: VisNode[],
    setLocal: (node: VisNode, x: number, y: number) => void,
): { width: number; height: number } {
    const cols = Math.ceil(Math.sqrt(fileNodes.length));

    let currentY = 0;
    let maxRowEndX = 0;

    // Group nodes by row
    const nodeRows: VisNode[][] = [];
    for (let i = 0; i < fileNodes.length; i++) {
        const row = Math.floor(i / cols);
        if (!nodeRows[row]) nodeRows[row] = [];
        nodeRows[row].push(fileNodes[i]);
    }

    for (const rowNodes of nodeRows) {
        let currentX = 0;
        for (let i = 0; i < rowNodes.length; i++) {
            const node = rowNodes[i];
            const labelLen = getLabelLength(node);

            let avgLen = labelLen;
            if (i > 0) {
                const prevLen = getLabelLength(rowNodes[i - 1]);
                avgLen = (labelLen + prevLen) / 2;
            }

            const dynamicSpacing = Math.max(
                MIN_NODE_SPACING,
                NODE_SPACING + (avgLen - 10) * CHAR_SPACING_FACTOR,
            );

            const localX = currentX + dynamicSpacing / 2;
            setLocal(node, localX, currentY);
            currentX += dynamicSpacing;

            const labelPadding = Math.max(20, labelLen * 4);
            maxRowEndX = Math.max(maxRowEndX, localX + labelPadding);
        }
        currentY += NODE_SPACING;
    }

    return {
        width: maxRowEndX + FILE_PADDING,
        height: currentY + FILE_PADDING,
    };
}

/**
 * Sized item for shelf-pack simulation. The folder tree's
 * `FolderNode` shape satisfies this without modification.
 */
export interface SizedItem {
    width: number;
    height: number;
}

/**
 * Run shelf-pack SIMULATION on a (height-sorted) array of sized items
 * to compute the bounding `width` / `height` of the packed result —
 * does NOT mutate the items. Used by `computeFolderSizes` to size a
 * parent from its children before the real arrangement step runs.
 */
export function simulateShelfPack(
    items: readonly SizedItem[],
    maxRowWidth: number,
    rowGap: number,
): { width: number; height: number } {
    if (items.length === 0) return { width: 0, height: 0 };

    let rowWidth = 0;
    let rowHeight = 0;
    let totalHeight = 0;
    let maxWidth = 0;

    for (const item of items) {
        if (rowWidth > 0 && rowWidth + item.width + rowGap > maxRowWidth) {
            totalHeight += rowHeight + rowGap;
            maxWidth = Math.max(maxWidth, rowWidth);
            rowWidth = 0;
            rowHeight = 0;
        }
        rowWidth += item.width + (rowWidth > 0 ? rowGap : 0);
        rowHeight = Math.max(rowHeight, item.height);
    }
    totalHeight += rowHeight;
    maxWidth = Math.max(maxWidth, rowWidth);

    return { width: maxWidth, height: totalHeight };
}

/**
 * Shelf-pack file blocks into a roughly-square grid. Mutates each
 * block's `x` / `y` in place. Width target: `max(400, sqrt(area) *
 * 1.5)` — the same heuristic the pre-loop-16 engine used.
 */
export function packFileBlocks(blocks: FolderBlock[], totalArea: number): void {
    if (blocks.length === 0) return;

    const targetWidth = Math.max(400, Math.sqrt(totalArea) * 1.5);
    let currentX = FILE_PADDING;
    let currentY = FILE_PADDING;
    let rowHeight = 0;

    for (const block of blocks) {
        if (currentX > FILE_PADDING && currentX + block.width > targetWidth) {
            currentX = FILE_PADDING;
            currentY += rowHeight + FOLDER_GAP;
            rowHeight = 0;
        }
        block.x = currentX;
        block.y = currentY;
        currentX += block.width + FOLDER_GAP;
        rowHeight = Math.max(rowHeight, block.height);
    }
}
