
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

        // Toggle visibility - DISABLED for 3-column layout
        // Object.entries(this.routes).forEach(([name, comp]) => {
        //     if (name === viewName) {
        //         if (comp.el) comp.el.style.display = 'block';
        //     } else {
        //         if (comp.el) comp.el.style.display = 'none';
        //     }
        // });
    }

    unmount() {
        if (this.unsubscribe) this.unsubscribe();
    }
}
