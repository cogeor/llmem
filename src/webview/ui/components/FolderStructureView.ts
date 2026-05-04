/**
 * FolderStructureView — orthogonal folder-structure graph.
 *
 * Per memo/design/02 (first half), this view answers "show me the WHOLE
 * folder structure in one glance." Rendered as a tidy-tree SVG with
 * strictly horizontal+vertical edges (no diagonals): root on the left,
 * children fanning right, parent→child connections drawn as L-shapes.
 *
 * Distinct from:
 *   - Worktree (left pane): a file-level explorer with watched-state
 *     toggles, used for selecting individual files into the graph.
 *   - PackageView ('packages' tab): folder cards + arcs for folder-level
 *     import/call edges (NOT the parent/child hierarchy this view shows).
 *
 * Pure browser code — uses `import type` for FolderTreeData/FolderNode
 * so the bundle stays clean of Node-only imports from src/graph/folder-tree.ts.
 */

import type { FolderTreeData, FolderNode } from '../../../graph/folder-tree';
import { DataProvider } from '../services/dataProvider';
import { State } from '../state';
import { AppState } from '../types';
import { escape } from '../utils/escape';

interface Props {
    el: HTMLElement;
    state: State;
    dataProvider: DataProvider;
}

const NODE_W = 168;
const NODE_H = 26;
const COL_GAP = 56;       // horizontal gap between depth columns
const COL_STEP = NODE_W + COL_GAP;
const ROW_GAP = 6;        // vertical gap between sibling rows
const ROW_STEP = NODE_H + ROW_GAP;
const PAD_X = 16;
const PAD_Y = 16;

interface LaidOutNode {
    node: FolderNode;
    depth: number;
    x: number;
    y: number;
    children: LaidOutNode[];
}

export class FolderStructureView {
    /** Public so Router (RouteComponent) can read the element it owns;
     *  the parent-grouped visibility toggle inspects `comp.el` directly. */
    el: HTMLElement;
    private state: State;
    private dataProvider: DataProvider;
    private tree: FolderTreeData | null = null;
    private clickHandlerBound = false;
    private unsubscribe?: () => void;

    constructor({ el, state, dataProvider }: Props) {
        this.el = el;
        this.state = state;
        this.dataProvider = dataProvider;
    }

    async mount(): Promise<void> {
        // Re-mount fires on dataProvider refresh; drop any prior subscription.
        this.unsubscribe?.();
        try {
            this.tree = await this.dataProvider.loadFolderTree();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // safe: msg is a string from a thrown Error; structural template otherwise.
            this.el.innerHTML = `<div class="folder-structure-error">${escape(msg)}</div>`;
            return;
        }
        this.render();

        if (!this.clickHandlerBound) {
            this.el.addEventListener('click', (e) => this.handleClick(e));
            this.clickHandlerBound = true;
        }

        this.unsubscribe = this.state.subscribe((s: AppState) => this.updateSelection(s));
    }

    private render(): void {
        if (!this.tree) return;
        // Skip the empty root ("") — render its children as the visible
        // first column. Top-level files (folder ".") are part of root's
        // children and naturally appear in the first column too.
        const topLevel = this.tree.root.children;
        if (topLevel.length === 0) {
            this.el.innerHTML = '<div class="folder-structure-empty">No folders to show.</div>';
            return;
        }

        const laidOut: LaidOutNode[] = [];
        let nextLeafY = 0;
        for (const child of topLevel) {
            laidOut.push(this.layoutNode(child, 0, () => nextLeafY, (y) => { nextLeafY = y; }));
        }

        const totalLeaves = nextLeafY / ROW_STEP;
        const maxDepth = this.maxDepth(laidOut);
        const width = PAD_X * 2 + (maxDepth + 1) * COL_STEP - COL_GAP;
        const height = PAD_Y * 2 + totalLeaves * ROW_STEP - ROW_GAP;

        const nodesSvg: string[] = [];
        const edgesSvg: string[] = [];
        for (const root of laidOut) {
            this.collectSvg(root, nodesSvg, edgesSvg);
        }

        // Edges first so nodes paint on top.
        // safe: width/height are numbers; structural template otherwise; node
        // text is escape()-wrapped inside collectSvg.
        this.el.innerHTML = `
            <div class="folder-structure-host">
                <svg class="folder-structure-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
                    <g class="folder-structure-edges">${edgesSvg.join('')}</g>
                    <g class="folder-structure-nodes">${nodesSvg.join('')}</g>
                </svg>
            </div>
        `;
    }

    /**
     * Tidy-tree layout: leaves get sequential y positions, internal
     * nodes sit at the midpoint between their first and last child.
     * x is determined by depth alone — the orthogonal-edge guarantee
     * relies on every node in a column sharing the same x.
     */
    private layoutNode(
        node: FolderNode,
        depth: number,
        getNextLeafY: () => number,
        setNextLeafY: (y: number) => void,
    ): LaidOutNode {
        const x = PAD_X + depth * COL_STEP;
        if (node.children.length === 0) {
            const y = PAD_Y + getNextLeafY();
            setNextLeafY(getNextLeafY() + ROW_STEP);
            return { node, depth, x, y, children: [] };
        }
        const childLayouts: LaidOutNode[] = [];
        for (const child of node.children) {
            childLayouts.push(this.layoutNode(child, depth + 1, getNextLeafY, setNextLeafY));
        }
        const firstY = childLayouts[0].y;
        const lastY = childLayouts[childLayouts.length - 1].y;
        const y = (firstY + lastY) / 2;
        return { node, depth, x, y, children: childLayouts };
    }

    private maxDepth(roots: LaidOutNode[]): number {
        let max = 0;
        const walk = (n: LaidOutNode): void => {
            if (n.depth > max) max = n.depth;
            for (const c of n.children) walk(c);
        };
        for (const r of roots) walk(r);
        return max;
    }

    private collectSvg(node: LaidOutNode, nodes: string[], edges: string[]): void {
        // Node rect + label.
        const safePath = escape(node.node.path);
        const safeName = escape(node.node.name === '' ? '/' : node.node.name);
        const docGlyph = node.node.documented ? '<tspan class="folder-structure-doc">  ✎</tspan>' : '';
        const labelY = node.y + NODE_H / 2;
        nodes.push(`
            <g class="folder-structure-node" data-path="${safePath}">
                <rect x="${node.x}" y="${node.y}" width="${NODE_W}" height="${NODE_H}" rx="3" ry="3"></rect>
                <text x="${node.x + 10}" y="${labelY}" class="folder-structure-name" dominant-baseline="middle">${safeName}${docGlyph}</text>
                <text x="${node.x + NODE_W - 10}" y="${labelY}" class="folder-structure-count" dominant-baseline="middle" text-anchor="end">${node.node.fileCount}</text>
            </g>
        `);

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
            this.collectSvg(child, nodes, edges);
        }
    }

    private handleClick(e: Event): void {
        const target = e.target as Element;
        const group = target.closest('.folder-structure-node');
        if (!group) return;
        const folderPath = (group as SVGGElement).getAttribute('data-path');
        if (folderPath === null) return;
        this.state.set({
            selectedPath: folderPath,
            selectedType: 'directory',
            selectionSource: 'explorer',
        });
    }

    private updateSelection({ selectedPath, selectedType }: AppState): void {
        const prev = this.el.querySelector('.folder-structure-node.is-selected');
        if (prev) prev.classList.remove('is-selected');
        if (selectedPath === null || selectedType !== 'directory') return;
        const group = this.el.querySelector(`.folder-structure-node[data-path="${CSS.escape(selectedPath)}"]`);
        group?.classList.add('is-selected');
    }

    unmount(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }
}
