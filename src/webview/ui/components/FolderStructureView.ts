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
import {
    Item,
    LaidOutItem,
    COL_STEP,
    COL_GAP,
    ROW_STEP,
    ROW_GAP,
    PAD_X,
    PAD_Y,
    layoutItem,
    maxDepth,
    collectSvg,
} from './folderStructureLayout';

interface Props {
    el: HTMLElement;
    state: State;
    dataProvider: DataProvider;
}

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
            laidOut.push(layoutItem(item, 0, () => nextLeafY, (y) => { nextLeafY = y; }));
        }

        const totalLeaves = nextLeafY / ROW_STEP;
        const depth = maxDepth(laidOut);
        const width = PAD_X * 2 + (depth + 1) * COL_STEP - COL_GAP;
        const height = PAD_Y * 2 + totalLeaves * ROW_STEP - ROW_GAP;

        const nodesSvg: string[] = [];
        const edgesSvg: string[] = [];
        for (const root of laidOut) {
            collectSvg(root, this.expanded, nodesSvg, edgesSvg);
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
