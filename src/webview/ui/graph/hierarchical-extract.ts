/**
 * Pure result-extraction for `HierarchicalLayout`.
 *
 * Extracted from `graph/HierarchicalLayout.ts` (Loop 22 file-size split).
 * Pure browser code — no node/vscode imports.
 *
 * `extractResults` walks the laid-out folder tree and emits the three
 * output collections (`nodePositions`, `folders`, `fileRegions`) the
 * renderer consumes. It reads finalized per-node measurements out of the
 * `measured` map that the layout pass populated, so the only state it
 * touches is threaded in explicitly — no `this`.
 */

import { FolderRegion, FileRegion } from './graphTypes';
import { MeasuredNode } from './layout-types';
import { groupNodesByFile } from './layout-pack';
import { FolderNode } from './folder-tree';

/**
 * Recursively collect folder regions, per-file regions, and finalized node
 * positions from a laid-out folder tree. Byte-for-byte the pre-split
 * `HierarchicalLayout.extractResults`, with `this.measured` passed in as
 * `measured`.
 */
export function extractResults(
    folder: FolderNode,
    measured: Map<string, MeasuredNode>,
    nodePositions: Map<string, { x: number; y: number }>,
    folders: FolderRegion[],
    fileRegions: FileRegion[],
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
            const m = measured.get(node.id);
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
        const m = measured.get(node.id);
        if (m && m.finalized) nodePositions.set(node.id, { x: m.x, y: m.y });
    }

    for (const child of folder.children.values()) {
        extractResults(child, measured, nodePositions, folders, fileRegions);
    }
}
