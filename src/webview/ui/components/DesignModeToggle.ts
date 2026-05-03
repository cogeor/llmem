/**
 * DesignModeToggle Component
 *
 * Toggle button for switching between view and edit modes in the design pane.
 * Shows save button when in edit mode.
 * Placed in the design pane header toolbar.
 */

import { AppState, DesignViewMode } from '../types';
import { State } from '../state';
import { edit, eye } from '../icons';

interface Props {
    el: HTMLElement;
    state: State;
    onSave?: () => void;
}

export class DesignModeToggle {
    private el: HTMLElement;
    private state: State;
    private onSave?: () => void;
    private unsubscribe?: () => void;

    constructor({ el, state, onSave }: Props) {
        this.el = el;
        this.state = state;
        this.onSave = onSave;
    }

    mount() {
        // Subscribe to state changes (will call callback immediately with current state)
        this.unsubscribe = this.state.subscribe((s: AppState) => {
            this.render(s.designViewMode);
        });
    }

    render(mode: DesignViewMode) {
        if (!this.el) return; // Guard against null element

        const isEditMode = mode === 'edit';

        // safe: all interpolations are author-controlled — boolean ternaries
        // (isEditMode), author-controlled SVG icons imported from icons.ts
        // (eye, edit), and static text labels.
        this.el.innerHTML = `
            <div style="display: flex; gap: 8px; align-items: center;">
                <button
                    class="toggle-btn"
                    id="design-mode-btn"
                    title="${isEditMode ? 'Switch to view mode' : 'Switch to edit mode'}"
                >
                    <span class="toggle-icon">${isEditMode ? eye : edit}</span>
                    <span class="toggle-text">${isEditMode ? 'View' : 'Edit'}</span>
                </button>
                ${isEditMode ? `
                    <button
                        class="toggle-btn"
                        id="design-save-btn"
                        title="Save changes (Ctrl+S)"
                        style="background: var(--button-primary-background, #0078d4); color: white;"
                    >
                        <span class="toggle-text">Save</span>
                    </button>
                    <span style="font-size: 11px; color: var(--foreground-muted, #888);">Ctrl+S</span>
                ` : ''}
            </div>
        `;

        // Attach click handlers
        const modeBtn = this.el.querySelector('#design-mode-btn');
        if (modeBtn) {
            modeBtn.addEventListener('click', () => {
                const newMode: DesignViewMode = isEditMode ? 'view' : 'edit';
                this.state.set({ designViewMode: newMode });
            });
        }

        const saveBtn = this.el.querySelector('#design-save-btn');
        if (saveBtn && this.onSave) {
            saveBtn.addEventListener('click', () => {
                this.onSave!();
            });
        }
    }

    unmount() {
        this.unsubscribe?.();
    }
}

