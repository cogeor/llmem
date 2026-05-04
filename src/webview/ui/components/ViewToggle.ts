/**
 * ViewToggle Component.
 *
 * Top-strip tab switcher for state.currentView. The router subscribes
 * to state and swaps visibility of route components.
 *
 * Routes:
 *   - 'graph'    → #graph-view
 *   - 'design'   → #design-view (solo in #design-pane; router hides
 *                  #graph-pane when this route is active so design
 *                  fills the remaining width)
 *   - 'packages' → #package-view
 *   - 'folders'  → #folder-structure-view (orthogonal folder graph)
 *
 * The component intentionally calls `state.set({ currentView })` rather
 * than `router.setRoute(...)` — Router has no `setRoute` method; the
 * state-subscriber pattern is the existing idiom (see main.ts).
 */

import { AppState } from '../types';
import { State } from '../state';

type ViewName = 'graph' | 'design' | 'packages' | 'folders';

interface Props {
    el: HTMLElement;
    state: State;
}

export class ViewToggle {
    private el: HTMLElement;
    private state: State;
    private unsubscribe?: () => void;
    /** Last rendered view; used to skip innerHTML rewrites when only
     *  unrelated state (selectedPath, watched paths, etc.) changed.
     *  Without this guard, every node click triggers a full innerHTML
     *  replacement of the header strip, causing a brief reflow that
     *  contributed to the "header disappears on graph click" bug. */
    private lastView: ViewName | null = null;

    constructor({ el, state }: Props) {
        this.el = el;
        this.state = state;
    }

    mount(): void {
        // Attach the delegated click handler once. The state-driven
        // re-render rewrites innerHTML; the listener stays alive on
        // this.el (the parent), so per-button click capture continues
        // to work after each render.
        this.attachClickHandler();
        // subscribe() invokes the callback immediately with the current
        // state, performing the initial render synchronously.
        this.unsubscribe = this.state.subscribe((s: AppState) => {
            if (s.currentView === this.lastView) return;
            this.lastView = s.currentView as ViewName;
            this.render(s.currentView);
        });
    }

    private render(active: ViewName): void {
        const isGraph = active === 'graph';
        const isDesign = active === 'design';
        const isPackages = active === 'packages';
        const isFolders = active === 'folders';
        // safe: structural template; class names and labels are
        // author-controlled literals; `active` is the AppState union
        // and only drives boolean ternaries (which produce 'active' or '').
        this.el.innerHTML = `
            <div class="view-toggle" role="tablist">
                <button class="view-toggle-btn ${isGraph ? 'active' : ''}" data-view="graph" type="button" role="tab" aria-selected="${isGraph}">Graph</button>
                <button class="view-toggle-btn ${isDesign ? 'active' : ''}" data-view="design" type="button" role="tab" aria-selected="${isDesign}">Design</button>
                <button class="view-toggle-btn ${isPackages ? 'active' : ''}" data-view="packages" type="button" role="tab" aria-selected="${isPackages}">Packages</button>
                <button class="view-toggle-btn ${isFolders ? 'active' : ''}" data-view="folders" type="button" role="tab" aria-selected="${isFolders}">Folders</button>
            </div>
        `;
    }

    private attachClickHandler(): void {
        this.el.addEventListener('click', (ev) => {
            const target = (ev.target as HTMLElement).closest('.view-toggle-btn');
            if (target === null) return;
            const view = (target as HTMLElement).dataset.view;
            if (view !== 'graph' && view !== 'design' && view !== 'packages' && view !== 'folders') return;
            this.state.set({ currentView: view });
        });
    }

    unmount(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }
}
