/**
 * ViewToggle Component (Loop 16).
 *
 * Tri-state toggle for the top-level webview route. Sibling to
 * DesignModeToggle (which is bi-state for state.designViewMode); this
 * component switches state.currentView between 'graph' | 'design' |
 * 'packages'. The router subscribes to state and swaps visibility of the
 * corresponding pane elements (see router.ts loop-16 parent-grouped
 * visibility toggle).
 *
 * The component intentionally calls `state.set({ currentView })` rather
 * than `router.setRoute(...)` — Router has no `setRoute` method; the
 * state-subscriber pattern is the existing idiom (see main.ts:59).
 *
 * Loop 14 shipped a two-button (Design / Graph) variant of this file;
 * loop 16 supersedes it with the three-button (Graph / Design / Packages)
 * variant required by the design/02 spec.
 */

import { AppState } from '../types';
import { State } from '../state';

type ViewName = 'graph' | 'design' | 'packages';

interface Props {
    el: HTMLElement;
    state: State;
}

export class ViewToggle {
    private el: HTMLElement;
    private state: State;
    private unsubscribe?: () => void;

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
        this.unsubscribe = this.state.subscribe((s: AppState) =>
            this.render(s.currentView),
        );
    }

    private render(active: ViewName): void {
        const isGraph = active === 'graph';
        const isDesign = active === 'design';
        const isPackages = active === 'packages';
        // safe: structural template; class names and labels are
        // author-controlled literals; `active` is the AppState union
        // and only drives boolean ternaries (which produce 'active' or '').
        this.el.innerHTML = `
            <div class="view-toggle" role="tablist">
                <button class="view-toggle-btn ${isGraph ? 'active' : ''}" data-view="graph" type="button" role="tab" aria-selected="${isGraph}">Graph</button>
                <button class="view-toggle-btn ${isDesign ? 'active' : ''}" data-view="design" type="button" role="tab" aria-selected="${isDesign}">Design</button>
                <button class="view-toggle-btn ${isPackages ? 'active' : ''}" data-view="packages" type="button" role="tab" aria-selected="${isPackages}">Packages</button>
            </div>
        `;
    }

    private attachClickHandler(): void {
        this.el.addEventListener('click', (ev) => {
            const target = (ev.target as HTMLElement).closest('.view-toggle-btn');
            if (target === null) return;
            const view = (target as HTMLElement).dataset.view;
            if (view !== 'graph' && view !== 'design' && view !== 'packages') return;
            this.state.set({ currentView: view });
        });
    }

    unmount(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }
}
