/**
 * DesignModeToggle Component
 *
 * Toggle button for switching between view and edit modes in the design pane.
 * Placed in the design pane header toolbar.
 */

import { DesignViewMode } from '../types';
import { edit, eye } from '../icons';

interface Props {
    el: HTMLElement;
    state: any;
}

export class DesignModeToggle {
    private el: HTMLElement;
    private state: any;
    private unsubscribe?: () => void;

    constructor({ el, state }: Props) {
        this.el = el;
        this.state = state;
    }

    mount() {
        // Subscribe to state changes (will call callback immediately with current state)
        this.unsubscribe = this.state.subscribe((s: any) => {
            this.render(s.designViewMode);
        });
    }

    render(mode: DesignViewMode) {
        if (!this.el) return; // Guard against null element

        const isEditMode = mode === 'edit';

        this.el.innerHTML = `
            <button
                class="toggle-btn"
                id="design-mode-btn"
                title="${isEditMode ? 'Switch to view mode' : 'Switch to edit mode'}"
            >
                <span class="toggle-icon">${isEditMode ? eye : edit}</span>
                <span class="toggle-text">${isEditMode ? 'View' : 'Edit'}</span>
            </button>
        `;

        // Attach click handler
        const btn = this.el.querySelector('#design-mode-btn');
        if (btn) {
            btn.addEventListener('click', () => {
                const newMode: DesignViewMode = isEditMode ? 'view' : 'edit';
                this.state.set({ designViewMode: newMode });
            });
        }
    }

    unmount() {
        this.unsubscribe?.();
    }
}

