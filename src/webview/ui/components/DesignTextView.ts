
import { DesignDocService } from '../services/designDocService';
import { AppState } from '../types';

interface DesignTextViewProps {
    el: HTMLElement;
    state: any; // Using explicit Type wrapper below or assume State class
    designDocService: DesignDocService;
}

export class DesignTextView {
    public el: HTMLElement;
    private state: any; // Type for State class instance
    private designDocService: DesignDocService;
    private shadow: ShadowRoot;
    private unsubscribe?: () => void;

    constructor({ el, state, designDocService }: DesignTextViewProps) {
        this.el = el;
        this.state = state;
        this.designDocService = designDocService;
        this.shadow = this.el.attachShadow({ mode: 'open' });
    }

    mount() {
        this.unsubscribe = this.state.subscribe((s: AppState) => this.onState(s));
    }

    async onState({ selectedPath, selectedType }: AppState) {
        if (!selectedPath) {
            this.shadow.innerHTML = `<div class="detail-empty" style="padding: 20px; color: #888;">Select a file or folder to view its design document.</div>`;
            return;
        }

        this.shadow.innerHTML = `<div class="detail-loading" style="padding: 20px;">Loading...</div>`;

        const content = await this.designDocService.fetchDesignDoc(selectedPath, selectedType);

        if (content) {
            this.shadow.innerHTML = content;
        } else {
            this.shadow.innerHTML = `<div class="detail-empty" style="padding: 20px; color: #888;">There is no design file for this selection.</div>`;
        }
    }

    unmount() { this.unsubscribe?.(); }
}
