
import { AppState } from './types';
import { State } from './state';
import { escape } from './utils/escape';

interface RouteComponent {
    el: HTMLElement;
    mount?(): void | Promise<void>;
    unmount?(): void;
    // ... other standard component methods
}

interface RouterProps {
    state: State;
    container: HTMLElement;
}

/**
 * Centralized Router for managing the main content area.
 * Listens to state.currentView and switches the active component.
 */
export class Router {
    private state: State;
    private container: HTMLElement;
    private routes: Record<string, RouteComponent> = {};
    private unsubscribe?: () => void;

    constructor({ state, container }: RouterProps) {
        this.state = state;
        this.container = container;
    }

    /**
     * Register a component for a specific view name.
     */
    registerRoute(viewName: string, component: RouteComponent) {
        this.routes[viewName] = component;
    }

    init() {
        this.unsubscribe = this.state.subscribe((s: AppState) => this.render(s));
    }

    render(state: AppState) {
        const viewName = state.currentView;
        // const component = this.routes[viewName];

        // Valid view?
        if (!this.routes[viewName]) {
            // Loop 13: viewName originates from AppState which the app code
            // controls today, but defensive escape closes the route by which
            // a future state.set({ currentView: '<script>...</script>' }) call
            // could land an unsanitized payload into innerHTML.
            const safeViewName = escape(String(viewName ?? ''));
            // safe: structural template with escape()-wrapped viewName.
            this.container.innerHTML = `<div class="error">View not found: ${safeViewName}</div>`;
            return;
        }

        // Loop 16: parent-grouped visibility toggle.
        //
        // Loop 14 disabled the global visibility toggle because the 3-column
        // layout shows #design-pane and #graph-pane side-by-side: a global
        // toggle would hide the design pane any time the active view was
        // 'graph' or 'packages'. Loop 16 re-enables the toggle but scopes
        // it to peers within the same DOM parent so that:
        //   - #graph-view and #package-view share #graph-pane's content area
        //     and SWAP based on currentView (one visible, one hidden).
        //   - #design-view lives alone in #design-pane and is left untouched
        //     by this toggle (it is the design pane's only registered route).
        //
        // The grouping uses the live DOM parent of each route's `el`. Solo
        // routes (no peers in their group) are skipped — leaving the loop-15
        // inline `display: none` on #package-view in place when the active
        // view doesn't share its parent. See PLAN.md loop 16 task 2 for the
        // full display-state matrix.
        const groups = new Map<Element, Array<{ name: string; el: HTMLElement }>>();
        for (const [name, comp] of Object.entries(this.routes)) {
            if (comp.el === undefined || comp.el === null) continue;
            const parent = comp.el.parentElement;
            if (parent === null) continue;
            const list = groups.get(parent) ?? [];
            list.push({ name, el: comp.el });
            groups.set(parent, list);
        }
        for (const list of groups.values()) {
            if (list.length < 2) continue; // Solo route — no peer to hide.
            for (const entry of list) {
                if (entry.name === viewName) {
                    entry.el.style.display = 'block';
                } else {
                    entry.el.style.display = 'none';
                }
            }
        }
    }

    unmount() {
        if (this.unsubscribe) this.unsubscribe();
    }
}
