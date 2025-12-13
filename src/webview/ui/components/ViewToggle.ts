
import { AppState } from '../types';

interface Props {
    el: HTMLElement;
    state: any;
}

export class ViewToggle {
    private el: HTMLElement;
    private state: any;
    private unsubscribe?: () => void;

    constructor({ el, state }: Props) {
        this.el = el;
        this.state = state;
    }

    mount() {
        this.el.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const btn = target.closest('[data-view]') as HTMLElement;
            if (!btn) return;
            this.state.set({ currentView: btn.dataset.view });
        });

        this.unsubscribe = this.state.subscribe((s: AppState) => this.render(s));
    }

    render({ currentView }: AppState) {
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
