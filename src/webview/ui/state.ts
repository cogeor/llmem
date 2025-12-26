
import { AppState } from './types';

export const initialState: AppState = {
    currentView: "design", // "design" | "graph"
    graphType: "import",   // "import" | "call"
    selectedPath: "src",   // Default to src for design view
    selectedType: "directory",
    expandedFolders: new Set(["src"]), // Expand src by default
    watchedPaths: new Set(),  // No paths watched initially (lazy mode)
    designViewMode: "view",  // Start in view mode (rendered HTML)
    callGraphAvailable: true,  // Will be updated when graph data loads
};

class State {
    private data: AppState;
    private listeners: Set<(state: AppState) => void>;

    constructor(initial: AppState) {
        this.data = { ...initial };
        this.listeners = new Set();
    }

    get(): AppState {
        return this.data;
    }

    set(partial: Partial<AppState>) {
        const next = { ...this.data, ...partial };
        this.data = next;
        this.notify();
    }

    subscribe(callback: (state: AppState) => void): () => void {
        this.listeners.add(callback);
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
