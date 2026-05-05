/**
 * Graph renderer DOM queries + color helpers (Loop 15 split).
 *
 * Extracted from `GraphRenderer.ts` to keep the orchestrator file under
 * the 400-line file-size budget. Pure helpers — they read the SVG node
 * group attributes (`data-id`, `data-file-id`) and a positions Map, and
 * never mutate state.
 *
 * Pinned by `tests/arch/file-size-budget.test.ts`.
 */

import type { VisNode } from '../types';
import type { FolderRegion } from './graphTypes';
import type { GroupRenderer } from './GroupRenderer';

/**
 * Drop the single top-level container folder (depth === 1) when there is
 * exactly one — this makes "src" the canvas background instead of a
 * heavy rectangle around everything. When multiple top-level folders
 * exist the input is returned unchanged.
 */
export function filterTopLevelContainer(folders: FolderRegion[]): FolderRegion[] {
    const topLevelFolders = folders.filter((f) => f.depth === 1);
    if (topLevelFolders.length !== 1) return folders;
    const topFolder = topLevelFolders[0];
    return folders.filter((f) => f !== topFolder);
}

export interface ContentBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Compute the bounding rectangle around the rendered folders. Returns
 * `null` when the input is empty (caller falls back to per-node bounds).
 */
export function foldersBounds(folders: FolderRegion[]): ContentBounds | null {
    if (folders.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const f of folders) {
        minX = Math.min(minX, f.x0);
        minY = Math.min(minY, f.y0);
        maxX = Math.max(maxX, f.x1);
        maxY = Math.max(maxY, f.y1);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Per-node bounds fallback when no folders rendered. Matches the
 * historical 200x100 padding used in `GraphRenderer.render`.
 */
export function nodePositionsBounds(
    nodePositions: Map<string, { x: number; y: number }>,
): ContentBounds | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let any = false;
    for (const pos of nodePositions.values()) {
        any = true;
        minX = Math.min(minX, pos.x);
        minY = Math.min(minY, pos.y);
        maxX = Math.max(maxX, pos.x + 200);
        maxY = Math.max(maxY, pos.y + 100);
    }
    if (!any) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Reconstruct the rendered node list from the `.node-group` SVG groups
 * and a `nodePositions` Map. Used after an incremental layout update so
 * the renderer can pass the union of old + new nodes to color/edge
 * passes without keeping a separate in-memory list.
 */
export function getAllNodesFromLayout(
    nodesGroup: SVGGElement,
    nodePositions: Map<string, { x: number; y: number }>,
): VisNode[] {
    const nodes: VisNode[] = [];
    const nodeGroups = nodesGroup.querySelectorAll('.node-group');
    nodeGroups.forEach((g) => {
        const id = g.getAttribute('data-id');
        const fileId = g.getAttribute('data-file-id');
        const label = g.querySelector('text')?.textContent;
        if (id !== null && nodePositions.has(id)) {
            nodes.push({
                id,
                label: label ?? id,
                group: '',
                fileId: fileId ?? id,
            });
        }
    });
    return nodes;
}

/**
 * Compute one color per node based on its containing folder. Nodes
 * outside any folder receive no entry in the returned map (callers fall
 * back to the renderer default).
 */
export function computeNodeColors(
    nodes: VisNode[],
    folders: FolderRegion[],
    groupRenderer: GroupRenderer,
): Map<string, string> {
    const colors = new Map<string, string>();
    for (const node of nodes) {
        const path = (node.fileId ?? node.id).replace(/\\/g, '/');
        const lastSlash = path.lastIndexOf('/');
        const folderPath = lastSlash > 0 ? path.substring(0, lastSlash) : '';

        const folder = folders.find((f) => f.path === folderPath);
        if (folder !== undefined) {
            colors.set(node.id, groupRenderer.getColorForPath(folder.path, folder.depth));
        }
    }
    return colors;
}

/**
 * Collect node IDs whose `data-file-id` lives under `folderPath`. Match
 * is prefix-based on the normalized (forward-slash) path with a `/`
 * separator, plus an exact-equality fallback so a top-level file
 * matches its own folder.
 */
export function getNodesInFolder(
    nodesGroup: SVGGElement,
    folderPath: string,
): Set<string> {
    const normalizedFolder = folderPath.replace(/\\/g, '/');
    const result = new Set<string>();

    const groups = nodesGroup.querySelectorAll('.node-group');
    groups.forEach((g) => {
        const id = g.getAttribute('data-id') ?? '';
        const fileId = g.getAttribute('data-file-id') ?? id;
        const normalizedFileId = fileId.replace(/\\/g, '/');

        if (
            normalizedFileId.startsWith(normalizedFolder + '/') ||
            normalizedFileId === normalizedFolder
        ) {
            result.add(id);
        }
    });

    return result;
}

/**
 * Collect node IDs whose `data-file-id` is exactly `filePath` (no
 * prefix match — files do not nest).
 */
export function getNodesInFile(nodesGroup: SVGGElement, filePath: string): Set<string> {
    const normalizedFile = filePath.replace(/\\/g, '/');
    const result = new Set<string>();

    const groups = nodesGroup.querySelectorAll('.node-group');
    groups.forEach((g) => {
        const id = g.getAttribute('data-id') ?? '';
        const fileId = g.getAttribute('data-file-id') ?? id;
        const normalizedFileId = fileId.replace(/\\/g, '/');

        if (normalizedFileId === normalizedFile) {
            result.add(id);
        }
    });

    return result;
}
