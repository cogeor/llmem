
import { DataProvider } from '../services/dataProvider';
import { AppState, DesignDoc, DesignViewMode } from '../types';
import { DesignRender } from './DesignRender';

// Helper to normalize path for display and matching
function normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
}

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
    text-align: left;
}

.detail-empty h3 {
    margin: 0 0 16px 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--foreground, #ccc);
}

.detail-empty p {
    margin: 0 0 12px 0;
    font-size: 13px;
    line-height: 1.5;
}

.detail-empty code {
    background-color: var(--code-background, #2d2d2d);
    padding: 2px 6px;
    border-radius: 3px;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 12px;
}

.detail-empty .hint {
    margin-top: 16px;
    padding: 12px;
    background-color: var(--code-background, #2d2d2d);
    border-radius: 4px;
    border-left: 3px solid var(--focus-outline, #007acc);
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
 * Supports saving edited markdown back to .arch files via the data provider.
 */
export class DesignTextView {
    public el: HTMLElement;
    private state: any;
    private dataProvider: DataProvider;
    private shadow: ShadowRoot;
    private container: HTMLElement;
    private unsubscribe?: () => void;
    private unsubscribeDesignDoc?: () => void;
    private designDocs: Record<string, DesignDoc> = {};
    private renderer: DesignRender | null = null;
    private currentPath: string | null = null;
    private isSaving = false;

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

        // Subscribe to design doc changes (for real-time updates)
        if (this.dataProvider.onDesignDocChange) {
            this.unsubscribeDesignDoc = this.dataProvider.onDesignDocChange((path, doc) => {
                this.handleDesignDocChange(path, doc);
            });
        }
    }

    /**
     * Handle design doc changes from WebSocket
     */
    private handleDesignDocChange(path: string, doc: DesignDoc | null): void {
        if (doc) {
            // Update or add doc to cache
            this.designDocs[path] = doc;
            console.log(`[DesignTextView] Doc updated: ${path}`);
        } else {
            // Delete doc from cache
            delete this.designDocs[path];
            console.log(`[DesignTextView] Doc deleted: ${path}`);
        }

        // If we're currently viewing this doc, refresh the display
        if (this.currentPath) {
            const currentState = this.state.get();
            // Re-trigger state handler to refresh display
            this.onState(currentState);
        }
    }

    /**
     * Trigger save from external button (public API)
     */
    public triggerSave(): void {
        console.log('[DesignTextView] triggerSave called');
        console.log('[DesignTextView] renderer exists:', !!this.renderer);
        console.log('[DesignTextView] currentPath:', this.currentPath);

        if (this.renderer && this.currentPath) {
            // Get current markdown from textarea
            const container = this.container;
            const textarea = container.querySelector('.design-markdown-editor') as HTMLTextAreaElement;

            console.log('[DesignTextView] textarea found:', !!textarea);
            if (textarea) {
                console.log('[DesignTextView] textarea value length:', textarea.value.length);
                console.log('[DesignTextView] textarea value preview:', textarea.value.substring(0, 100));
                this.handleSave(textarea.value);
            } else {
                console.error('[DesignTextView] Textarea not found in container');
            }
        } else {
            console.error('[DesignTextView] Cannot save - no renderer or currentPath');
        }
    }

    /**
     * Save the current design doc
     */
    private async handleSave(markdown: string): Promise<void> {
        console.log('[DesignTextView] handleSave called');
        console.log('[DesignTextView] markdown length:', markdown?.length);
        console.log('[DesignTextView] markdown preview:', markdown?.substring(0, 100));

        if (!this.currentPath || this.isSaving) {
            console.error('[DesignTextView] Cannot save - no currentPath or already saving');
            return;
        }

        // Determine the .arch path for saving
        // The currentPath is the source file path (e.g., "src/parser.ts")
        // We save to .arch/{full-path-with-extension}.md
        // This preserves the full source path including extension
        let archPath = `${this.currentPath}.md`;

        console.log(`[DesignTextView] Saving to: ${archPath}`);
        console.log(`[DesignTextView] Content to save:`, markdown);
        this.isSaving = true;

        try {
            if (this.dataProvider.saveDesignDoc) {
                const success = await this.dataProvider.saveDesignDoc(archPath, markdown);
                if (success) {
                    console.log(`[DesignTextView] Saved successfully: ${archPath}`);
                    // Note: The WebSocket will broadcast the update and cache will be updated
                } else {
                    console.error(`[DesignTextView] Save failed: ${archPath}`);
                    // Could show error UI here
                }
            } else {
                console.warn('[DesignTextView] saveDesignDoc not supported by data provider');
            }
        } catch (e) {
            console.error(`[DesignTextView] Save error:`, e);
        } finally {
            this.isSaving = false;
        }
    }

    async onState({ selectedPath, selectedType, designViewMode, watchedPaths }: AppState) {
        if (!selectedPath) {
            this.container.innerHTML = `<div class="detail-empty"><p>Select a file or folder to view its design document.</p></div>`;
            this.currentPath = null;
            this.renderer = null;
            return;
        }

        // Fetch doc from cache (may be stale from embedded data)
        let doc = this.fetchDesignDoc(selectedPath, selectedType);

        // If doc not found in cache AND we're in standalone mode, try fetching from API
        // This ensures we get fresh data even if embedded data is stale
        if (!doc && this.dataProvider.getDesignDoc) {
            const archPath = this.getArchPath(selectedPath, selectedType);
            if (archPath && this.dataProvider.saveDesignDoc) {
                // Try to fetch from server
                try {
                    const fetched = await (this.dataProvider as any).designDocCache?.fetch(archPath);
                    if (fetched) {
                        doc = fetched;
                        // Update local cache
                        const cacheKey = this.getCacheKey(selectedPath, selectedType);
                        if (cacheKey && doc) {
                            this.designDocs[cacheKey] = doc;
                        }
                    }
                } catch (e) {
                    console.warn('[DesignTextView] Failed to fetch doc from API:', e);
                }
            }
        }

        if (!doc) {
            // Show informative empty state with MCP command instructions
            const normalizedPath = normalizePath(selectedPath);
            const isWatched = watchedPaths?.has(selectedPath) || false;
            const commandType = selectedType === 'directory' ? 'folder_info' : 'file_info';

            let html = `
                <div class="detail-empty">
                    <h3>No design file found</h3>
                    <p>There is no design documentation for this ${selectedType || 'item'}.</p>
                    <p>To create one, use the MCP command:</p>
                    <p><code>${commandType} ${normalizedPath}</code></p>
            `;

            // If not watched, add hint about toggling watch first
            if (!isWatched) {
                html += `
                    <div class="hint">
                        <strong>Tip:</strong> Toggle the watch button <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ccc;vertical-align:middle;"></span> in the explorer first to start tracking this ${selectedType || 'item'}.
                    </div>
                `;
            }

            html += `</div>`;

            this.container.innerHTML = html;
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
                onSave: (markdown: string) => {
                    this.handleSave(markdown);
                },
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
     * Get the .arch path for a given source path
     */
    private getArchPath(selectedPath: string, selectedType: "file" | "directory" | null): string {
        let archPath = normalizePath(selectedPath);
        if (selectedType === 'file') {
            // Remove extension
            const lastDotIndex = archPath.lastIndexOf('.');
            if (lastDotIndex > 0) {
                archPath = archPath.substring(0, lastDotIndex);
            }
        }
        return archPath;
    }

    /**
     * Get cache key for a path
     */
    private getCacheKey(selectedPath: string, selectedType: "file" | "directory" | null): string | null {
        const normalizedPath = normalizePath(selectedPath);

        if (selectedType === 'directory') {
            return `${normalizedPath}/README.html`;
        } else {
            // Try with and without extension
            const basePath = normalizedPath.replace(/\.[^/.]+$/, '');
            return `${basePath}.html`;
        }
    }

    /**
     * Fetch design doc content from the loaded docs.
     * Only looks for exact matches - does NOT fall back to parent directories.
     * For directories, looks for README.md files.
     */
    private fetchDesignDoc(selectedPath: string | null, selectedType: "file" | "directory" | null): DesignDoc | null {
        if (!selectedPath) return null;

        // Normalize path - keep the full path including extension for files
        // Design docs are stored as {path}.html, e.g. src/info/cli.ts.html
        let currentPath: string = normalizePath(selectedPath);

        const candidates: string[] = [];

        // Full path (with extension for files)
        candidates.push(currentPath);

        // Also try without extension for backward compatibility
        if (selectedType === 'file') {
            const lastDotIndex = currentPath.lastIndexOf('.');
            if (lastDotIndex > 0) {
                candidates.push(currentPath.substring(0, lastDotIndex));
            }
        }

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

            // Check file formats: .html (converted from .md) and .txt
            const htmlKey = `${key}.html`;
            const txtKey = `${key}.txt`;

            if (this.designDocs[htmlKey]) return this.designDocs[htmlKey];
            if (this.designDocs[txtKey]) return this.designDocs[txtKey];
        }

        // No fallback to parent directories - return null if not found
        return null;
    }

    unmount() {
        this.unsubscribe?.();
        this.unsubscribeDesignDoc?.();
    }
}
