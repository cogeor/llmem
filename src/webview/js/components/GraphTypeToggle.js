export class GraphTypeToggle {
    constructor({ el, state }) {
        this.el = el;
        this.state = state;
    }

    mount() {
        this.el.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-graph-type]");
            if (!btn) return;
            this.state.set({ graphType: btn.dataset.graphType }); // "import" | "call"
        });

        this.unsubscribe = this.state.subscribe((s) => this.render(s));
    }

    render({ currentView, graphType }) {
        if (currentView !== "graph") {
            this.el.innerHTML = "";
            this.el.style.display = 'none';
            return;
        }

        this.el.style.display = 'block';
        this.el.innerHTML = `
        <div class="segmented" role="group" aria-label="Graph type">
            <button data-graph-type="import" class="${graphType === "import" ? "is-active" : ""}">Import graph</button>
            <button data-graph-type="call" class="${graphType === "call" ? "is-active" : ""}">Call graph</button>
        </div>
        `;
    }

    unmount() { this.unsubscribe?.(); }
}
