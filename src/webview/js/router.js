/**
 * Handles coordination between state and view switching.
 * In this simple SPA, State drives the view. The Router might just be a concept,
 * but let's make it responsible for the "page" logic if needed.
 * Actually, our ViewToggle and GraphView components already subscribe to state.
 * So we don't need a heavy router. 
 * This file might simply be an initializer or coordinator if needed.
 * For now, I'll export a simple mount function that ensures correct initial visibility.
 */

export class Router {
    constructor(state) {
        this.state = state;
    }

    init() {
        // Any global route handling? 
        // For now, the components listen to state 'currentView'.
        // This is sufficient.
    }
}
