/**
 * FolderStructureView — orthogonal folder-structure graph.
 *
 * Per memo/design/02 (first half), this view answers "show me the WHOLE
 * folder structure in one glance." Rendered as a tidy-tree SVG with
 * strictly horizontal+vertical edges (no diagonals): root on the left,
 * children fanning right, parent→child connections drawn as L-shapes.
 *
 * Clicking a folder TOGGLES its files inline: the folder's direct files
 * (sourced from the worktree) appear as leaf nodes in the next column,
 * alongside its subfolders. Clicking again collapses them. This is the
 * 2-pane replacement for the old design pane — the file list lives right
 * in the graph instead of a separate panel.
 *
 * Distinct from:
 *   - Worktree (left pane): a file-level explorer with watched-state
 *     toggles, used for selecting individual files into the graph.
 *
 * Pure browser code — uses `import type` for FolderTreeData/FolderNode
 * imported from `src/contracts/folder-tree.ts` (Loop 17 contracts split)
 * so the bundle stays clean of Node-only imports from src/graph/.
 */

import type { FolderTreeData, FolderNode } from '../../../contracts/folder-tree';
import { DataProvider } from '../services/dataProvider';
import { State } from '../state';
import { AppState, WorkTreeNode } from '../types';
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

/** Forward-slash a path so worktree (possibly `\` on Windows) and the
 *  forward-slash folder-tree keys compare equal. */
function normalize(p: string): string {
    return p.replace(/\\/g, '/');
}

/** A file living directly under a folder, surfaced when that folder is
 *  expanded. */
interface FileLeaf {
    name: string;
    path: string;
}

/**
 * Unified layout item: either a folder (from the folder tree) or a file
 * leaf (from the worktree, shown only when its parent is expanded).
 */
interface Item {
    kind: 'folder' | 'file';
    path: string;
    name: string;
    /** Folder only: recursive file count shown on the right. */
    fileCount?: number;
    /** Folder only: whether `.arch/{path}/README.md` exists. */
    documented?: boolean;
    /** Folder only: has at least one direct file (so it can expand). */
    expandable?: boolean;
    children: Item[];
}

interface LaidOutItem {
    item: Item;
    depth: number;
    x: number;
    y: number;
    children: LaidOutItem[];
}

export class FolderStructureView {
    /** Public so Router (RouteComponent) can read the element it owns;
     *  the parent-grouped visibility toggle inspects `comp.el` directly. */
    el: HTMLElement;
    private state: State;
    private dataProvider: DataProvider;
    private tree: FolderTreeData | null = null;
    /** Direct files per folder, keyed by normalized forward-slash path.
     *  The top-level bucket is stored under both `""` and `"."`. */
    private filesByFolder = new Map<string, FileLeaf[]>();
    /** Folder paths whose direct files are currently shown inline. */
    private expanded = new Set<string>();
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
        // Worktree drives the inline file lists. It is optional — in
        // graph-only mode it is empty and folders simply have nothing to
        // expand, which is fine.
        try {
            const worktree = await this.dataProvider.loadWorkTree();
            this.buildFilesByFolder(worktree);
        } catch {
            this.filesByFolder.clear();
        }
        this.render();

        if (!this.clickHandlerBound) {
            this.el.addEventListener('click', (e) => this.handleClick(e));
            this.clickHandlerBound = true;
        }

        this.unsubscribe = this.state.subscribe((s: AppState) => this.updateSelection(s));
    }

    /** Walk the worktree once, recording each directory's direct files. */
    private buildFilesByFolder(root: WorkTreeNode): void {
        this.filesByFolder.clear();
        const walk = (node: WorkTreeNode): void => {
            if (node.type !== 'directory') return;
            const files: FileLeaf[] = node.children
                .filter((c): c is Extract<WorkTreeNode, { type: 'file' }> => c.type === 'file')
                .map((f) => ({ name: f.name, path: normalize(f.path) }));
            this.filesByFolder.set(normalize(node.path), files);
            for (const c of node.children) walk(c);
        };
        walk(root);
        // The folder tree models top-level files as a folder named "."; the
        // worktree keeps them as direct children of the root. Alias the two
        // so expanding "." shows the repo-root files.
        const rootFiles =
            root.type === 'directory'
                ? root.children
                      .filter((c): c is Extract<WorkTreeNode, { type: 'file' }> => c.type === 'file')
                      .map((f) => ({ name: f.name, path: normalize(f.path) }))
                : [];
        this.filesByFolder.set('.', rootFiles);
        this.filesByFolder.set('', rootFiles);
    }

    private filesFor(folderPath: string): FileLeaf[] {
        return this.filesByFolder.get(normalize(folderPath)) ?? [];
    }

    /** Build the unified layout tree from a folder node, attaching file
     *  leaves for any expanded folder. */
    private toItem(node: FolderNode): Item {
        const files = this.filesFor(node.path);
        const children: Item[] = node.children.map((c) => this.toItem(c));
        if (this.expanded.has(node.path)) {
            for (const f of files) {
                children.push({ kind: 'file', path: f.path, name: f.name, children: [] });
            }
        }
        return {
            kind: 'folder',
            path: node.path,
            name: node.name,
            fileCount: node.fileCount,
            documented: node.documented,
            expandable: files.length > 0,
            children,
        };
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

        const items = topLevel.map((c) => this.toItem(c));

        const laidOut: LaidOutItem[] = [];
        let nextLeafY = 0;
        for (const item of items) {
            laidOut.push(this.layoutItem(item, 0, () => nextLeafY, (y) => { nextLeafY = y; }));
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
        // Re-apply the current selection highlight after a full re-render.
        this.updateSelection(this.state.get());
    }

    /**
     * Tidy-tree layout: leaves get sequential y positions, internal
     * nodes sit at the midpoint between their first and last child.
     * x is determined by depth alone — the orthogonal-edge guarantee
     * relies on every node in a column sharing the same x.
     */
    private layoutItem(
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
            childLayouts.push(this.layoutItem(child, depth + 1, getNextLeafY, setNextLeafY));
        }
        const firstY = childLayouts[0].y;
        const lastY = childLayouts[childLayouts.length - 1].y;
        const y = (firstY + lastY) / 2;
        return { item, depth, x, y, children: childLayouts };
    }

    private maxDepth(roots: LaidOutItem[]): number {
        let max = 0;
        const walk = (n: LaidOutItem): void => {
            if (n.depth > max) max = n.depth;
            for (const c of n.children) walk(c);
        };
        for (const r of roots) walk(r);
        return max;
    }

    private collectSvg(node: LaidOutItem, nodes: string[], edges: string[]): void {
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
                ? `<tspan class="folder-structure-caret">${this.expanded.has(item.path) ? '▾ ' : '▸ '}</tspan>`
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
            this.collectSvg(child, nodes, edges);
        }
    }

    private handleClick(e: Event): void {
        const target = e.target as Element;
        const group = target.closest('.folder-structure-node');
        if (!group) return;
        const path = (group as SVGGElement).getAttribute('data-path');
        if (path === null) return;
        const kind = (group as SVGGElement).getAttribute('data-kind');

        if (kind === 'file') {
            this.state.set({
                selectedPath: path,
                selectedType: 'file',
                selectionSource: 'explorer',
            });
            return;
        }

        // Folder: toggle inline file expansion (when it has files) and
        // select it. Re-render so the file leaves appear/disappear.
        if (this.filesFor(path).length > 0) {
            if (this.expanded.has(path)) {
                this.expanded.delete(path);
            } else {
                this.expanded.add(path);
            }
            this.render();
        }
        this.state.set({
            selectedPath: path,
            selectedType: 'directory',
            selectionSource: 'explorer',
        });
    }

    private updateSelection({ selectedPath }: AppState): void {
        const prev = this.el.querySelector('.folder-structure-node.is-selected');
        if (prev) prev.classList.remove('is-selected');
        if (selectedPath === null) return;
        const group = this.el.querySelector(
            `.folder-structure-node[data-path="${CSS.escape(selectedPath)}"]`,
        );
        group?.classList.add('is-selected');
    }

    unmount(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }
}
