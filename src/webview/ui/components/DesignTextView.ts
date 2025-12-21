
import { DataProvider } from '../services/dataProvider';
import { AppState } from '../types';

interface DesignTextViewProps {
    el: HTMLElement;
    state: any;
    dataProvider: DataProvider;
}

// Inline styles for the Shadow DOM (works in both VS Code and standalone)
const DETAIL_STYLES = `
<style>
.detail-view {
    padding: 16px;
    font-size: 14px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-wrap: break-word;
    color: var(--foreground, #333);
}

.detail-view h1, .detail-view h2, .detail-view h3,
.detail-view h4, .detail-view h5, .detail-view h6 {
    color: var(--foreground, #333);
    margin-top: 1.5em;
    margin-bottom: 0.5em;
}

.detail-view a {
    color: var(--focus-outline, #007acc);
    text-decoration: none;
}

.detail-view a:hover {
    text-decoration: underline;
}

.detail-view pre {
    background-color: var(--code-background, #f5f5f5);
    padding: 8px;
    border-radius: 4px;
    border: 1px solid var(--border-color, #ddd);
    overflow-x: auto;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
}

.detail-view code {
    background-color: var(--code-background, #f5f5f5);
    padding: 2px 4px;
    border-radius: 3px;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 0.9em;
}

.detail-view pre code {
    background-color: transparent;
    padding: 0;
    border: none;
}

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
 * Displays design documentation for the selected file/folder.
 */
export class DesignTextView {
    public el: HTMLElement;
    private state: any;
    private dataProvider: DataProvider;
    private shadow: ShadowRoot;
    private unsubscribe?: () => void;
    private designDocs: Record<string, string> = {};

    constructor({ el, state, dataProvider }: DesignTextViewProps) {
        this.el = el;
        this.state = state;
        this.dataProvider = dataProvider;
        this.shadow = this.el.attachShadow({ mode: 'open' });
    }

    async mount() {
        // Load design docs
        this.designDocs = await this.dataProvider.loadDesignDocs();

        // Subscribe to state changes
        this.unsubscribe = this.state.subscribe((s: AppState) => this.onState(s));
    }

    async onState({ selectedPath, selectedType }: AppState) {
        if (!selectedPath) {
            this.shadow.innerHTML = `${DETAIL_STYLES}<div class="detail-empty">Select a file or folder to view its design document.</div>`;
            return;
        }

        this.shadow.innerHTML = `${DETAIL_STYLES}<div class="detail-loading">Loading...</div>`;

        const content = this.fetchDesignDoc(selectedPath, selectedType);

        if (content) {
            this.shadow.innerHTML = `${DETAIL_STYLES}<div class="detail-view">${content}</div>`;
        } else {
            this.shadow.innerHTML = `${DETAIL_STYLES}<div class="detail-empty">There is no design file for this selection.</div>`;
        }
    }

    /**
     * Fetch design doc content from the loaded docs.
     * Tries various path patterns to find a match.
     * For directories, prioritizes README.md files.
     */
    private fetchDesignDoc(selectedPath: string | null, selectedType: "file" | "directory" | null): string | null {
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
                // For directories, check README.md first (the new .arch/{path}/README.md format)
                if (selectedType === 'directory') {
                    const readmeKey = `${key}/README.md`;
                    if (this.designDocs[readmeKey]) return this.designDocs[readmeKey];
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
