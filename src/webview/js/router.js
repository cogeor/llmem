/**
 * Handles coordination between state and view switching.
 * In this simple SPA, State drives the view. The Router might just be a concept,
 * but let's make it responsible for the "page" logic if needed.
 * Actually, our ViewToggle and GraphView components already subscribe to state.
 * So we don't need a heavy router. 
 * This file might simply be an initializer or coordinator if needed.
 * For now, I'll export a simple mount function that ensures correct initial visibility.
 */


/**
 * Centralized Router for managing the main content area.
 * Listens to state.currentView and switches the active component.
 */
export class Router {
    constructor({ state, container }) {
        this.state = state;
        this.container = container;
        this.routes = {}; // viewName -> component
    }

    /**
     * Register a component for a specific view name.
     * @param {string} viewName - e.g. "graph", "design"
     * @param {Object} component - Must have mount(el?), unmount(), update?
     */
    registerRoute(viewName, component) {
        this.routes[viewName] = component;
    }

    init() {
        this.unsubscribe = this.state.subscribe((s) => this.render(s));
    }

    render(state) {
        const viewName = state.currentView;
        const component = this.routes[viewName];

        if (!component) {
            this.container.innerHTML = `<div class="error">View not found: ${viewName}</div>`;
            return;
        }

        // Simple Routing Strategy:
        // 1. Hide all other registered components (if they share the container? No, we likely want to swap).
        // BUT components like GraphView might want to stay alive (canvas state).
        // If we want to support "Keep Alive", we should toggle visibility.

        // Approach: usage of `display: none` moved here from components.
        // We assume components are ALREADY mounted to their specific elements in `main.js`?
        // OR we mount them here?

        // Plan says: "appends the active component's element (or toggles visibility if caching is desired)."
        // To preserve graph state, let's toggle visibility of the *containers* of registered components.
        // So `registerRoute` should probably take the container element for that view? 
        // Or component instance has `.el`.

        Object.entries(this.routes).forEach(([name, comp]) => {
            if (name === viewName) {
                if (comp.el) comp.el.style.display = 'block';
                // Optional: call update() or similar if needed when showing
            } else {
                if (comp.el) comp.el.style.display = 'none';
            }
        });
    }

    unmount() {
        if (this.unsubscribe) this.unsubscribe();
    }
}

