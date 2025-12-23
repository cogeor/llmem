
import { DataProvider } from '../services/dataProvider';
import { AppState, DesignDoc, DesignViewMode } from '../types';
import { DesignRender } from './DesignRender';

interface DesignTextViewProps {
    el: HTMLElement;
    state: any;
    dataProvider: DataProvider;
}

// Inline styles for the Shadow DOM (works in both VS Code and standalone)
const DETAIL_STYLES = `
<style>
/* ===== Shadow DOM Host ===== */
:host {
    display: block;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    white-space: normal !important;  /* Override parent pre-wrap from .detail-view */
}

/* ===== View Mode: Rendered HTML ===== */
.design-view-content {
    width: 100%;
    padding: 16px;
    margin: 0;
    font-size: 14px;
    line-height: 1.5;
    color: var(--foreground, #333);
    box-sizing: border-box;
}

/* Headings */
.design-view-content h1,
.design-view-content h2,
.design-view-content h3,
.design-view-content h4,
.design-view-content h5,
.design-view-content h6 {
    color: var(--foreground, #333);
    margin-bottom: 0.5em;
}

/* Links */
.design-view-content a {
    color: var(--focus-outline, #007acc);
    text-decoration: none;
}
.design-view-content a:hover {
    text-decoration: underline;
}

/* Code blocks (fenced with backticks) */
.design-view-content pre {
    background-color: var(--code-background, #f5f5f5);
    padding: 8px;
    border-radius: 4px;
    border: 1px solid var(--border-color, #ddd);
    overflow-x: auto;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
}

/* Inline code (single backticks) */
.design-view-content code {
    background-color: var(--code-background, #f5f5f5);
    padding: 2px 4px;
    border-radius: 3px;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 0.9em;
}

/* Code inside pre blocks - reset inline code styling */
.design-view-content pre code {
    background-color: transparent;
    padding: 0;
    border: none;
}

/* ===== Edit Mode: Markdown Textarea ===== */
.design-markdown-editor {
    width: 100%;
    min-height: 100%;
    padding: 16px;
    margin: 0;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 13px;
    line-height: 1.5;
    border: none;
    outline: none;
    resize: none;
    overflow: hidden;
    box-sizing: border-box;
    background-color: var(--background, #fff);
    color: var(--foreground, #333);
}

/* ===== Empty/Loading States ===== */
.detail-empty {
    padding: 24px;
    color: var(--foreground-muted, #888);
    text-align: center;
    font-style: italic;
}

.detail-loading {
    padding: 24px;
    color: var(--foreground-muted, #888);
}
</style>
`;

/**
 * DesignTextView Component
 * Displays design documentation for the selected file/folder with view/edit toggle.
 */
export class DesignTextView {
    public el: HTMLElement;
    private state: any;
    private dataProvider: DataProvider;
    private shadow: ShadowRoot;
    private container: HTMLElement;
    private unsubscribe?: () => void;
    private designDocs: Record<string, DesignDoc> = {};
    private renderer: DesignRender | null = null;
    private currentPath: string | null = null;

    constructor({ el, state, dataProvider }: DesignTextViewProps) {
        this.el = el;
        this.state = state;
        this.dataProvider = dataProvider;
        this.shadow = this.el.attachShadow({ mode: 'open' });

        // Setup shadow DOM with styles and content container
        this.shadow.innerHTML = DETAIL_STYLES;
        this.container = document.createElement('div');
        this.container.style.width = '100%';
        this.container.style.height = '100%';
        this.container.style.overflow = 'auto';  // This container handles scrolling
        this.container.style.boxSizing = 'border-box';
        this.container.style.padding = '0';
        this.container.style.margin = '0';
        this.shadow.appendChild(this.container);
    }

    async mount() {
        // Load design docs
        this.designDocs = await this.dataProvider.loadDesignDocs();

        // Subscribe to state changes (will call callback immediately with current state)
        this.unsubscribe = this.state.subscribe((s: AppState) => this.onState(s));
    }

    async onState({ selectedPath, selectedType, designViewMode }: AppState) {
        if (!selectedPath) {
            this.container.innerHTML = `< div class="detail-empty" > Select a file or folder to view its design document.</div>`;
            this.currentPath = null;
            this.renderer = null;
            return;
        }

        const doc = this.fetchDesignDoc(selectedPath, selectedType);

        if (!doc) {
            this.container.innerHTML = `<div class="detail-empty">There is no design file for this selection.</div>`;
            this.currentPath = null;
            this.renderer = null;
            return;
        }

        // Check if we're rendering a different document or mode changed
        const pathChanged = this.currentPath !== selectedPath;
        if (pathChanged || !this.renderer) {
            // Create new renderer
            this.currentPath = selectedPath;
            this.renderer = new DesignRender({
                markdown: doc.markdown,
                html: doc.html,
                mode: designViewMode,
                onModeChange: (mode: DesignViewMode) => {
                    this.state.set({ designViewMode: mode });
                },
                // onSave will be implemented in Phase 2
            });

            // Mount renderer
            this.renderer.mount(this.container);
        } else {
            // Update existing renderer (mode changed)
            this.renderer.updateProps({
                mode: designViewMode,
                markdown: doc.markdown,
                html: doc.html,
            });
            this.renderer.mount(this.container);
        }
    }

    /**
     * Fetch design doc content from the loaded docs.
     * Tries various path patterns to find a match.
     * For directories, prioritizes README.md files.
     */
    private fetchDesignDoc(selectedPath: string | null, selectedType: "file" | "directory" | null): DesignDoc | null {
        if (!selectedPath) return null;

        // Normalize path
        let currentPath: string | null = selectedPath.replace(/\\/g, '/');
        if (selectedType === 'file') {
            const lastDotIndex = currentPath.lastIndexOf('.');
            if (lastDotIndex > 0) {
                currentPath = currentPath.substring(0, lastDotIndex);
            }
        }

        // Loop to find doc or parent doc
        while (currentPath !== null) {
            const candidates: string[] = [];

            // Full path
            candidates.push(currentPath);

            // Basename
            const baseName = currentPath.split('/').pop();
            if (baseName && baseName !== currentPath) {
                candidates.push(baseName);
            }

            // Check each candidate
            for (const key of candidates) {
                // For directories, check README files (the new .arch/{path}/README.md format)
                if (selectedType === 'directory') {
                    // Check for README.html (converted from .md), README.txt, and README.md
                    const readmeHtml = `${key}/README.html`;
                    const readmeTxt = `${key}/README.txt`;
                    const readmeMd = `${key}/README.md`;

                    if (this.designDocs[readmeHtml]) return this.designDocs[readmeHtml];
                    if (this.designDocs[readmeTxt]) return this.designDocs[readmeTxt];
                    if (this.designDocs[readmeMd]) return this.designDocs[readmeMd];
                }

                // Then check legacy formats
                const htmlKey = `${key}.html`;
                const txtKey = `${key}.txt`;

                if (this.designDocs[htmlKey]) return this.designDocs[htmlKey];
                if (this.designDocs[txtKey]) return this.designDocs[txtKey];
            }

            if (currentPath === "") break;

            // Move to parent
            const lastSlash = currentPath.lastIndexOf('/');
            if (lastSlash === -1) {
                currentPath = "";
            } else {
                currentPath = currentPath.substring(0, lastSlash);
            }
        }

        return null;
    }

    unmount() {
        this.unsubscribe?.();
    }
}
