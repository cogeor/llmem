/**
 * FolderCardList — folder-card tree DOM (Loop 15 split).
 *
 * Owns the `.package-tree` mount point. Renders one `<div class=
 * "package-card">` per non-root folder with depth-based indent, an
 * optional ✎ glyph for documented folders, and a delegated click
 * handler that surfaces the clicked folder's path through
 * `props.onCardClick`.
 *
 * The component does NOT touch app state. PackageView (orchestrator)
 * wires `onCardClick(folderPath)` to the appropriate
 * `state.set({ selectedPath, selectedType: 'directory', ... })` call.
 *
 * Loop 15 cross-references:
 *   - Pinned by `tests/unit/web-viewer/package-view.test.ts` (cards +
 *     glyph + indentation + unmount).
 *   - Pinned by `tests/unit/web-viewer/package-view-description.test.ts`
 *     ("card click drives state.set without changing currentView").
 */

import type { FolderNode } from '../../../graph/folder-tree';
import { escape } from '../utils/escape';
import { WebviewLogger, createWebviewLogger } from '../services/webview-logger';

export interface FolderCardListProps {
    /** `<div class="package-tree">` mount point. */
    el: HTMLElement;
    /** Fired when the user clicks a folder card. */
    onCardClick: (folderPath: string) => void;
    logger?: WebviewLogger;
}

export class FolderCardList {
    private readonly props: FolderCardListProps;
    private readonly logger: WebviewLogger;
    private clickHandler: ((ev: Event) => void) | null = null;

    constructor(props: FolderCardListProps) {
        this.props = props;
        this.logger = props.logger ?? createWebviewLogger({ enabled: false });
    }

    /**
     * Render the card tree from a `FolderNode` root. The synthetic empty
     * root (`path: ''`, `name: ''`) is skipped — its children render as
     * the top-level entries (preserving PackageView's loop-14 behavior).
     *
     * Idempotent: calling `render` again replaces the prior content and
     * removes the previous delegated click handler before re-attaching.
     */
    render(root: FolderNode): void {
        // Skip the empty root — render its children as the top-level cards.
        const cards = root.children.map((child) => this.renderNode(child, 0)).join('');
        // safe: structural template; renderNode escapes every interpolated
        // string field.
        this.props.el.innerHTML = cards;
        this.attachClickHandler();
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

    /**
     * Attach the delegated card-click handler. Idempotent: removes the
     * previously-attached handler (if any) before re-attaching, so
     * repeated `render()` calls do not stack listeners.
     */
    private attachClickHandler(): void {
        if (this.clickHandler !== null) {
            this.props.el.removeEventListener('click', this.clickHandler);
        }
        const handler = (ev: Event): void => {
            const target = ev.target as HTMLElement | null;
            if (target === null) return;
            const card = target.closest('.package-card');
            if (card === null) return;
            const path = (card as HTMLElement).dataset.path ?? '';
            this.props.onCardClick(path);
        };
        this.clickHandler = handler;
        this.props.el.addEventListener('click', handler);
        // Logger reference kept so future debug surfaces (loop 16+) can
        // hook in without re-wiring constructor plumbing.
        void this.logger;
    }

    unmount(): void {
        if (this.clickHandler !== null) {
            this.props.el.removeEventListener('click', this.clickHandler);
            this.clickHandler = null;
        }
        this.props.el.innerHTML = '';
    }
}
