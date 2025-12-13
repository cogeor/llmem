export class DesignTextView {
    constructor({ el, state, designDocService }) {
        this.el = el;
        this.state = state;
        this.designDocService = designDocService;

        // Use Shadow DOM for CSS Isolation of design docs
        this.shadow = this.el.attachShadow({ mode: 'open' });
    }

    mount() {
        this.unsubscribe = this.state.subscribe((s) => this.onState(s));
    }

    async onState({ selectedPath, selectedType }) {
        // Router handles visibility (display: none/block on this.el)
        // We only care about content update here.

        if (!selectedPath) {
            this.shadow.innerHTML = `<div class="detail-empty" style="padding: 20px; color: #888;">Select a file or folder to view its design document.</div>`;
            return;
        }

        this.shadow.innerHTML = `<div class="detail-loading" style="padding: 20px;">Loading...</div>`;

        const content = await this.designDocService.fetchDesignDoc(selectedPath, selectedType);

        if (content) {
            // Content is full HTML with <style> tags. Shadow DOM isolates it.
            // We might want to inject some base styles for the shadow root if needed, 
            // but the doc usually has its own.
            this.shadow.innerHTML = content;
        } else {
            this.shadow.innerHTML = `<div class="detail-empty" style="padding: 20px; color: #888;">There is no design file for this selection.</div>`;
        }
    }

    unmount() { this.unsubscribe?.(); }
}
