/**
 * Simple state management with subscription support.
 */
export const initialState = {
    currentView: "design", // "design" | "graph"
    graphType: "import",   // "import" | "call"
    selectedPath: "src",    // Default to src
    selectedType: "directory", // Default type
    expandedFolders: new Set(["src"]), // Expand src by default
};

class State {
    constructor(initial) {
        this.data = { ...initial };
        this.listeners = new Set();
    }

    get() {
        return this.data;
    }

    set(partial) {
        const next = { ...this.data, ...partial };
        // Simple distinct check could go here, but omitted for simplicity
        this.data = next;
        this.notify();
    }

    subscribe(callback) {
        this.listeners.add(callback);
        // Immediate call with current state
        callback(this.data);
        return () => this.listeners.delete(callback);
    }

    notify() {
        for (const listener of this.listeners) {
            listener(this.data);
        }
    }
}

export const state = new State(initialState);
