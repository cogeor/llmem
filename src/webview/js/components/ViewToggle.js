export class ViewToggle {
    constructor({ el, state }) {
        this.el = el;
        this.state = state;
    }

    mount() {
        this.el.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-view]');
            if (!btn) return;
            this.state.set({ currentView: btn.dataset.view });
        });

        this.unsubscribe = this.state.subscribe((s) => this.render(s));
    }

    render({ currentView }) {
        this.el.innerHTML = `
            <div class="segmented" role="group">
                <button data-view="design" class="${currentView === 'design' ? 'is-active' : ''}">Design Script</button>
                <button data-view="graph" class="${currentView === 'graph' ? 'is-active' : ''}">Graph view</button>
            </div>
        `;
    }

    unmount() {
        this.unsubscribe?.();
    }
}
