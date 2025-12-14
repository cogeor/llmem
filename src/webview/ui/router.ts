
import { AppState } from './types';

interface RouteComponent {
    el: HTMLElement;
    mount?(): void | Promise<void>;
    unmount?(): void;
    // ... other standard component methods
}

interface RouterProps {
    state: any; // State class
    container: HTMLElement;
}

/**
 * Centralized Router for managing the main content area.
 * Listens to state.currentView and switches the active component.
 */
export class Router {
    private state: any;
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
            this.container.innerHTML = `<div class="error">View not found: ${viewName}</div>`;
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
