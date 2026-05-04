
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
        // The two registered routes ('graph', 'packages') share the
        // #graph-pane content area; the parent-grouped toggle hides the
        // inactive one. The middle pane (#design-pane / FolderTreeView)
        // is not a router-managed route — it is always visible.
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
