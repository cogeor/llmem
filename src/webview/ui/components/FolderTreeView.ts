/**
 * FolderTreeView — indented folder-only tree (memo/design/02 first-half spec).
 *
 * Renders the FolderNode tree from `dataProvider.loadFolderTree()` as a
 * vertical, expandable, folder-only navigator (no files). Lives in the
 * middle pane of the 3-column layout, replacing the previous DesignTextView.
 *
 * Selection contract matches Worktree:
 *   click row → state.set({ selectedPath, selectedType: 'directory',
 *                            selectionSource: 'explorer' })
 * which the GraphView already responds to (folder pan/highlight). No new
 * graph wiring needed.
 *
 * Pure browser code — uses `import type` for FolderTreeData/FolderNode so
 * the bundle stays clean of Node-only imports (`path` from src/graph/folder-tree.ts).
 */

import type { FolderTreeData, FolderNode } from '../../../graph/folder-tree';
import { DataProvider } from '../services/dataProvider';
import { State } from '../state';
import { AppState } from '../types';
import { folder, chevronRight } from '../icons';
import { escape } from '../utils/escape';

interface Props {
    el: HTMLElement;
    state: State;
    dataProvider: DataProvider;
}

const STORAGE_KEY = 'llmem:folderTreeExpanded';

export class FolderTreeView {
    private el: HTMLElement;
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
        // Re-mount happens on dataProvider refresh (see main.ts onRefresh);
        // drop the prior subscription before re-rendering to avoid double-firing.
        this.unsubscribe?.();
        try {
            this.tree = await this.dataProvider.loadFolderTree();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // safe: msg is a string from a thrown Error; structural template otherwise.
            this.el.innerHTML = `<div class="folder-tree-error">${escape(msg)}</div>`;
            return;
        }
        this.render();
        this.restoreExpansion();

        if (!this.clickHandlerBound) {
            this.el.addEventListener('click', (e) => this.handleClick(e));
            this.clickHandlerBound = true;
        }

        this.unsubscribe = this.state.subscribe((s: AppState) => this.updateSelection(s));
    }

    private render(): void {
        if (!this.tree) return;
        const topLevel = this.tree.root.children;
        // safe: every interpolation in renderNode is escape()-wrapped.
        let html = '<ul class="folder-tree-list">';
        for (const child of topLevel) {
            html += this.renderNode(child, 0);
        }
        html += '</ul>';
        this.el.innerHTML = html;
    }

    private renderNode(node: FolderNode, depth: number): string {
        const safePath = escape(node.path);
        const safeName = escape(node.name);
        const docGlyph = node.documented ? '<span class="folder-doc-glyph" title="has design doc">✎</span>' : '';
        const hasChildren = node.children.length > 0;

        let html = `
            <li class="folder-tree-node" data-path="${safePath}">
                <div class="folder-tree-item" style="padding-left: ${depth * 12 + 12}px">
                    <span class="folder-tree-arrow ${hasChildren ? '' : 'folder-tree-arrow-empty'}">${hasChildren ? chevronRight : ''}</span>
                    <span class="folder-tree-icon">${folder}</span>
                    <span class="folder-tree-label">${safeName}</span>
                    <span class="folder-tree-count">${node.fileCount}</span>
                    ${docGlyph}
                </div>
        `;
        if (hasChildren) {
            html += `<ul class="folder-tree-children" data-path="${safePath}">`;
            for (const child of node.children) {
                html += this.renderNode(child, depth + 1);
            }
            html += '</ul>';
        }
        html += '</li>';
        return html;
    }

    private handleClick(e: Event): void {
        const target = e.target as HTMLElement;
        const item = target.closest('.folder-tree-item');
        if (!item) return;
        const nodeEl = item.parentElement as HTMLElement;
        const folderPath = nodeEl.dataset.path;
        if (folderPath === undefined) return;

        const childrenUl = nodeEl.querySelector(':scope > .folder-tree-children');
        if (childrenUl) {
            const wasExpanded = childrenUl.classList.contains('is-expanded');
            childrenUl.classList.toggle('is-expanded');
            item.setAttribute('aria-expanded', String(!wasExpanded));
            this.saveExpansion();
        }

        this.state.set({
            selectedPath: folderPath,
            selectedType: 'directory',
            selectionSource: 'explorer',
        });
    }

    private updateSelection({ selectedPath, selectedType }: AppState): void {
        const prev = this.el.querySelector('.folder-tree-item.is-selected');
        if (prev) prev.classList.remove('is-selected');
        if (selectedPath === null || selectedType !== 'directory') return;
        const nodeEl = this.el.querySelector(`.folder-tree-node[data-path="${CSS.escape(selectedPath)}"]`);
        if (!nodeEl) return;
        const item = nodeEl.querySelector(':scope > .folder-tree-item');
        item?.classList.add('is-selected');

        // Expand ancestors so the selection is visible.
        let parent = nodeEl.parentElement?.closest('.folder-tree-children');
        while (parent) {
            parent.classList.add('is-expanded');
            const parentNodeLi = parent.parentElement;
            const parentItem = parentNodeLi?.querySelector(':scope > .folder-tree-item');
            if (parentItem) parentItem.setAttribute('aria-expanded', 'true');
            parent = parent.parentElement?.closest('.folder-tree-children');
        }
    }

    private saveExpansion(): void {
        if (this.dataProvider.hostKind === 'vscode') return;
        const expanded: string[] = [];
        this.el.querySelectorAll('.folder-tree-children.is-expanded').forEach((ul) => {
            const p = (ul as HTMLElement).dataset.path;
            if (p !== undefined) expanded.push(p);
        });
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(expanded));
        } catch (e) {
            console.warn('[FolderTreeView] Failed to save expansion state:', e);
        }
    }

    private restoreExpansion(): void {
        if (this.dataProvider.hostKind === 'vscode') return;
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (!saved) return;
            const paths = JSON.parse(saved) as string[];
            for (const p of paths) {
                const ul = this.el.querySelector(`.folder-tree-children[data-path="${CSS.escape(p)}"]`);
                if (ul) {
                    ul.classList.add('is-expanded');
                    const parentLi = ul.parentElement;
                    const parentItem = parentLi?.querySelector(':scope > .folder-tree-item');
                    if (parentItem) parentItem.setAttribute('aria-expanded', 'true');
                }
            }
        } catch (e) {
            console.warn('[FolderTreeView] Failed to restore expansion state:', e);
        }
    }

    unmount(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }
}
