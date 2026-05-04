/**
 * PackageView Component (Loop 14 skeleton).
 *
 * Renders a static folder-card list from `dataProvider.loadFolderTree()`.
 * Each card shows `name`, `fileCount`, and a `✎` glyph when `documented`.
 * No edges, no description panel, no click handlers — those land in
 * loops 15 and 16.
 *
 * Uses `import type` for `FolderTreeData` / `FolderNode` so the runtime
 * bundle stays browser-clean (no `path` / `replaceAll` from
 * `src/graph/folder-tree.ts`). Loop 13's tsconfig adjustment makes the
 * type-check side work; esbuild elides the type-only imports.
 */

import type { FolderTreeData, FolderNode } from '../../../graph/folder-tree';
import { DataProvider } from '../services/dataProvider';
import { State } from '../state';
import { escape } from '../utils/escape';

interface Props {
    el: HTMLElement;
    state: State;
    dataProvider: DataProvider;
}

export class PackageView {
    public el: HTMLElement;
    private state: State;
    private dataProvider: DataProvider;
    private tree: FolderTreeData | null = null;

    constructor({ el, state, dataProvider }: Props) {
        this.el = el;
        this.state = state;
        this.dataProvider = dataProvider;
    }

    async mount(): Promise<void> {
        try {
            this.tree = await this.dataProvider.loadFolderTree();
        } catch (err) {
            // Loop 14: failure is the expected path when no scan has run yet.
            // Render an empty-state surfacing the underlying error message
            // (already escape-safe via the wrapping `escape()`). Must NOT
            // re-throw — main.ts awaits this in Promise.all and an unhandled
            // rejection would break the entire webview bootstrap.
            const safeMessage = escape(String((err as Error)?.message ?? 'Failed to load folder tree'));
            // safe: structural template; message is escape()-wrapped.
            this.el.innerHTML = `<div class="package-empty">${safeMessage}</div>`;
            return;
        }
        this.render(this.tree.root);
    }

    private render(root: FolderNode): void {
        // Skip the empty root (path: "", name: "") — render its children as
        // the top-level entries.
        const cards = root.children.map((child) => this.renderNode(child, 0)).join('');
        // safe: structural template; renderNode escapes every interpolated
        // string field.
        this.el.innerHTML = `<div class="package-tree">${cards}</div>`;
    }

    private renderNode(node: FolderNode, depth: number): string {
        const safeName = escape(node.name);
        const safePath = escape(node.path);
        const documentedGlyph = node.documented
            ? '<span class="package-glyph" title="documented">✎</span>'
            : '';
        // Depth-based margin-left: 16px per level. Cheap to override later.
        const indentStyle = `margin-left:${depth * 16}px`;
        const childCards = node.children
            .map((c) => this.renderNode(c, depth + 1))
            .join('');
        // safe: structural template; safeName / safePath are escape()-wrapped;
        // documentedGlyph is a controlled literal; depth is a number;
        // indentStyle is a controlled string.
        return `
            <div class="package-card" data-path="${safePath}" style="${indentStyle}">
                <span class="package-name">${safeName}</span>
                <span class="package-count">${node.fileCount} files</span>
                ${documentedGlyph}
            </div>
            ${childCards}
        `;
    }

    unmount(): void {
        // Clear DOM. Loop 14 has no subscriptions or listeners to drop.
        this.el.innerHTML = '';
        this.tree = null;
    }
}
