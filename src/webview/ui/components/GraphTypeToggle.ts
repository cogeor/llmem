
import { AppState } from '../types';

interface Props {
    el: HTMLElement;
    state: any;
}

export class GraphTypeToggle {
    private el: HTMLElement;
    private state: any;
    private unsubscribe?: () => void;

    constructor({ el, state }: Props) {
        this.el = el;
        this.state = state;
    }

    mount() {
        this.el.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;
            const btn = target.closest("[data-graph-type]") as HTMLElement;
            if (!btn) return;
            this.state.set({ graphType: btn.dataset.graphType }); // "import" | "call"
        });

        this.unsubscribe = this.state.subscribe((s: AppState) => this.render(s));
    }

    render({ currentView, graphType, callGraphAvailable }: AppState) {
        // In 3-column layout, graph is always visible, so toggle should be too
        this.el.style.display = 'block';

        // Only show call graph button if call graph data is available
        // (Backend determines availability based on graph data, not languages)
        const callButton = callGraphAvailable
            ? `<button data-graph-type="call" class="${graphType === "call" ? "is-active" : ""}">Call graph</button>`
            : '';

        this.el.innerHTML = `
        <div class="segmented" role="group" aria-label="Graph type">
            <button data-graph-type="import" class="${graphType === "import" ? "is-active" : ""}">Import graph</button>
            ${callButton}
        </div>
        `;
    }

    unmount() { this.unsubscribe?.(); }
}
