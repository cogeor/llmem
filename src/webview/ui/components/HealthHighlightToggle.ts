
import { AppState } from '../types';
import { State } from '../state';

interface Props {
    el: HTMLElement;
    state: State;
}

/**
 * Loop 08 (health-highlight): a single on/off segmented button mounted next to
 * the graph-type toggle. When active, the app enters health-highlight mode
 * (clone edges amber-dashed, smelly nodes badged). Mirrors `GraphTypeToggle`'s
 * mount/render/unmount shape exactly.
 */
export class HealthHighlightToggle {
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
            const btn = target.closest('[data-health-highlight]') as HTMLElement;
            if (!btn) return;
            const current = this.state.get().healthHighlight;
            this.state.set({ healthHighlight: !current });
        });

        this.unsubscribe = this.state.subscribe((s: AppState) => this.render(s));
    }

    render({ healthHighlight }: AppState) {
        this.el.style.display = 'block';
        const active = healthHighlight ? 'is-active' : '';
        // safe: only the static `is-active` literal is interpolated; the label
        // and attributes are author-controlled string literals.
        this.el.innerHTML = `
        <div class="segmented" role="group" aria-label="Health highlight">
            <button data-health-highlight class="${active}" title="Highlight clones and code smells">Health</button>
        </div>
        `;
    }

    unmount() { this.unsubscribe?.(); }
}
