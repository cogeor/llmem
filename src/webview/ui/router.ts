
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

        // Parent-grouped visibility toggle.
        //
        // Routes that share a DOM parent SWAP based on currentView (one
        // visible, one hidden). Today: #graph-view, #package-view, and
        // #folder-structure-view all live inside #graph-pane's content
        // area and are siblings; the active one is shown, the others are
        // hidden. #design-view is solo in #design-pane and is left alone
        // by this toggle.
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

        // Pane-level visibility for the solo 'design' route. With the
        // parent-grouped toggle above unable to give it a visible
        // response, hide the right-side graph pane when 'design' is
        // active so the design pane fills the remaining width:
        //   - currentView='design'              → hide #graph-pane + splitter-2.
        //   - currentView='graph'/'packages'/'folders' → show #graph-pane + splitter-2.
        const graphPane = document.getElementById('graph-pane');
        const splitter2 = document.getElementById('splitter-2');
        const showGraphPane = viewName !== 'design';
        if (graphPane) graphPane.style.display = showGraphPane ? '' : 'none';
        if (splitter2) splitter2.style.display = showGraphPane ? '' : 'none';
    }

    unmount() {
        if (this.unsubscribe) this.unsubscribe();
    }
}
