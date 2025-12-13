export class DesignTextView {
    constructor({ el, state, designDocService }) {
        this.el = el;
        this.state = state;
        this.designDocService = designDocService;
    }

    mount() {
        this.unsubscribe = this.state.subscribe((s) => this.onState(s));
    }

    async onState({ currentView, selectedPath, selectedType }) {
        if (currentView !== 'design') {
            this.el.style.display = 'none';
            return;
        }
        this.el.style.display = 'block';

        if (!selectedPath) {
            this.el.innerHTML = `<div class="detail-empty">Select a file or folder to view its design document.</div>`;
            return;
        }

        this.el.innerHTML = `<div class="detail-loading">Loading...</div>`;

        const content = await this.designDocService.fetchDesignDoc(selectedPath, selectedType);

        if (content) {
            // Content is expected to be HTML (from markdown conversion) or plain text?
            // "Note: webview design texts are in webview/arch and already html. Use them as-is."
            this.el.innerHTML = `<div class="detail-view">${content}</div>`;
        } else {
            this.el.innerHTML = `<div class="detail-empty">There is no design file for this selection.</div>`;
        }
    }

    unmount() { this.unsubscribe?.(); }
}
