/**
 * Pure tidy-tree layout + SVG building for `FolderStructureView`.
 *
 * Extracted from `components/FolderStructureView.ts` (Loop 22 file-size
 * split). Pure browser code — no node/vscode imports; `escape` comes from
 * the browser-safe `../utils/escape`.
 *
 * This module owns the view's geometry constants and the three pure passes
 * the view drives:
 *   - `layoutItem`  — assign x (by depth) and y (tidy-tree) positions,
 *   - `maxDepth`    — deepest column index, for the SVG width,
 *   - `collectSvg`  — emit `<g>`/`<path>` strings for nodes + edges.
 * State the SVG pass needs (the `expanded` folder set) is threaded in as an
 * explicit parameter rather than read off the component.
 */

import { escape } from '../utils/escape';

export const NODE_W = 168;
export const NODE_H = 26;
export const COL_GAP = 56;       // horizontal gap between depth columns
export const COL_STEP = NODE_W + COL_GAP;
export const ROW_GAP = 6;        // vertical gap between sibling rows
export const ROW_STEP = NODE_H + ROW_GAP;
export const PAD_X = 16;
export const PAD_Y = 16;

/**
 * Unified layout item: either a folder (from the folder tree) or a file
 * leaf (from the worktree, shown only when its parent is expanded).
 */
export interface Item {
    kind: 'folder' | 'file';
    path: string;
    name: string;
    /** Folder only: recursive file count shown on the right. */
    fileCount?: number;
    /** Folder only: whether `.llmem/docs/{path}/README.md` exists. */
    documented?: boolean;
    /** Folder only: has at least one direct file (so it can expand). */
    expandable?: boolean;
    children: Item[];
}

export interface LaidOutItem {
    item: Item;
    depth: number;
    x: number;
    y: number;
    children: LaidOutItem[];
}

/**
 * Tidy-tree layout: leaves get sequential y positions, internal nodes sit
 * at the midpoint between their first and last child. x is determined by
 * depth alone — the orthogonal-edge guarantee relies on every node in a
 * column sharing the same x.
 */
export function layoutItem(
    item: Item,
    depth: number,
    getNextLeafY: () => number,
    setNextLeafY: (y: number) => void,
): LaidOutItem {
    const x = PAD_X + depth * COL_STEP;
    if (item.children.length === 0) {
        const y = PAD_Y + getNextLeafY();
        setNextLeafY(getNextLeafY() + ROW_STEP);
        return { item, depth, x, y, children: [] };
    }
    const childLayouts: LaidOutItem[] = [];
    for (const child of item.children) {
        childLayouts.push(layoutItem(child, depth + 1, getNextLeafY, setNextLeafY));
    }
    const firstY = childLayouts[0].y;
    const lastY = childLayouts[childLayouts.length - 1].y;
    const y = (firstY + lastY) / 2;
    return { item, depth, x, y, children: childLayouts };
}

/** Deepest column index across the laid-out roots. */
export function maxDepth(roots: LaidOutItem[]): number {
    let max = 0;
    const walk = (n: LaidOutItem): void => {
        if (n.depth > max) max = n.depth;
        for (const c of n.children) walk(c);
    };
    for (const r of roots) walk(r);
    return max;
}

/**
 * Emit `<g>` node strings and `<path>` edge strings for the subtree rooted
 * at `node`. `expanded` (the set of folder paths currently showing their
 * inline files) selects the open/closed caret glyph.
 */
export function collectSvg(
    node: LaidOutItem,
    expanded: Set<string>,
    nodes: string[],
    edges: string[],
): void {
    const { item } = node;
    const safePath = escape(item.path);
    const labelY = node.y + NODE_H / 2;

    if (item.kind === 'file') {
        // File leaf: distinct class, no count, leading dot glyph.
        const safeName = escape(item.name);
        nodes.push(`
            <g class="folder-structure-node is-file" data-path="${safePath}" data-kind="file">
                <rect x="${node.x}" y="${node.y}" width="${NODE_W}" height="${NODE_H}" rx="3" ry="3"></rect>
                <text x="${node.x + 10}" y="${labelY}" class="folder-structure-name" dominant-baseline="middle">${safeName}</text>
            </g>
        `);
    } else {
        // Folder node: name (+ doc glyph), file count, and an expand
        // caret when it has direct files to reveal.
        const safeName = escape(item.name === '' ? '/' : item.name);
        const docGlyph = item.documented ? '<tspan class="folder-structure-doc">  ✎</tspan>' : '';
        const caret = item.expandable
            ? `<tspan class="folder-structure-caret">${expanded.has(item.path) ? '▾ ' : '▸ '}</tspan>`
            : '';
        nodes.push(`
            <g class="folder-structure-node" data-path="${safePath}" data-kind="folder">
                <rect x="${node.x}" y="${node.y}" width="${NODE_W}" height="${NODE_H}" rx="3" ry="3"></rect>
                <text x="${node.x + 10}" y="${labelY}" class="folder-structure-name" dominant-baseline="middle">${caret}${safeName}${docGlyph}</text>
                <text x="${node.x + NODE_W - 10}" y="${labelY}" class="folder-structure-count" dominant-baseline="middle" text-anchor="end">${item.fileCount ?? ''}</text>
            </g>
        `);
    }

    // Orthogonal parent→child edges.
    for (const child of node.children) {
        const px = node.x + NODE_W;
        const py = node.y + NODE_H / 2;
        const cx = child.x;
        const cy = child.y + NODE_H / 2;
        const midX = px + COL_GAP / 2;
        // M px,py H midX V cy H cx — strict horizontal+vertical only.
        edges.push(`<path d="M${px} ${py} H${midX} V${cy} H${cx}" />`);
    }

    for (const child of node.children) {
        collectSvg(child, expanded, nodes, edges);
    }
}
