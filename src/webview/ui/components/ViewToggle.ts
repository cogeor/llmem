
import { AppState } from '../types';
import { State } from '../state';

interface Props {
    el: HTMLElement;
    state: State;
}

export class ViewToggle {
    private el: HTMLElement;
    private state: State;
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
            // Loop 14: validate the dataset value rather than passing the
            // raw string into a typed state setter.
            const next = btn.dataset.view;
            if (next === 'design' || next === 'graph') {
                this.state.set({ currentView: next });
            }
        });

        this.unsubscribe = this.state.subscribe((s: AppState) => this.render(s));
    }

    render({ currentView }: AppState) {
        // safe: currentView is a controlled string union; only equality
        // comparisons are interpolated. All other content is static.
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
