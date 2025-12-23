/**
 * DesignRender Component
 *
 * Handles rendering of design documents in two modes:
 * - View mode: Renders HTML (converted markdown)
 * - Edit mode: Shows markdown source in textarea
 *
 * Features:
 * - Toggle between view/edit modes
 * - Preserve scroll position when switching
 * - Keyboard shortcut (Ctrl+S) for save (Phase 2)
 */

import { DesignViewMode } from '../types';

export interface DesignRenderProps {
    markdown: string;
    html: string;
    mode: DesignViewMode;
    onModeChange: (mode: DesignViewMode) => void;
    onSave?: (markdown: string) => void;  // For Phase 2
}

export class DesignRender {
    private props: DesignRenderProps;
    private scrollPosition: number = 0;
    private textareaElement: HTMLTextAreaElement | null = null;
    private viewElement: HTMLElement | null = null;

    constructor(props: DesignRenderProps) {
        this.props = props;
    }

    /**
     * Update props and re-render
     */
    updateProps(props: Partial<DesignRenderProps>): void {
        this.props = { ...this.props, ...props };
    }

    /**
     * Save current scroll position
     */
    private saveScrollPosition(): void {
        if (this.props.mode === 'view' && this.viewElement) {
            this.scrollPosition = this.viewElement.scrollTop;
        } else if (this.props.mode === 'edit' && this.textareaElement) {
            this.scrollPosition = this.textareaElement.scrollTop;
        }
    }

    /**
     * Restore scroll position after mode switch
     */
    private restoreScrollPosition(): void {
        setTimeout(() => {
            if (this.props.mode === 'view' && this.viewElement) {
                this.viewElement.scrollTop = this.scrollPosition;
            } else if (this.props.mode === 'edit' && this.textareaElement) {
                this.textareaElement.scrollTop = this.scrollPosition;
            }
        }, 0);
    }

    /**
     * Handle mode toggle
     */
    private handleModeToggle(): void {
        this.saveScrollPosition();
        const newMode: DesignViewMode = this.props.mode === 'view' ? 'edit' : 'view';
        this.props.onModeChange(newMode);
    }

    /**
     * Handle keyboard shortcuts
     */
    private handleKeyDown(e: KeyboardEvent): void {
        // Ctrl+S or Cmd+S for save (Phase 2)
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            if (this.props.onSave && this.props.mode === 'edit' && this.textareaElement) {
                const editedMarkdown = this.textareaElement.value;
                this.props.onSave(editedMarkdown);
            }
        }
    }

    /**
     * Render the component (no toolbar - that's in the pane header)
     */
    render(): string {
        const { mode, markdown, html } = this.props;

        if (mode === 'edit') {
            return `
                <textarea
                    class="design-markdown-editor"
                    spellcheck="false"
                    placeholder="Enter markdown here..."
                >${this.escapeHtml(markdown)}</textarea>
            `;
        } else {
            return `
                <div class="design-view-content">${html || ''}</div>
            `;
        }
    }

    /**
     * Mount the component and attach event listeners
     */
    mount(container: HTMLElement): void {
        container.innerHTML = this.render();

        // Find elements
        this.textareaElement = container.querySelector('.design-markdown-editor');
        this.viewElement = container.querySelector('.design-view-content');

        // Attach keyboard shortcuts (Ctrl+S for save in Phase 2)
        if (this.textareaElement) {
            this.textareaElement.addEventListener('keydown', (e) => this.handleKeyDown(e));
        }

        // Restore scroll position
        this.restoreScrollPosition();
    }

    /**
     * Escape HTML for safe rendering in textarea
     */
    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
