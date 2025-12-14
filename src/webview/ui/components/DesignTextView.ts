
import { DataProvider } from '../services/dataProvider';
import { AppState } from '../types';

interface DesignTextViewProps {
    el: HTMLElement;
    state: any;
    dataProvider: DataProvider;
}

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
            this.shadow.innerHTML = `<div class="detail-empty" style="padding: 20px; color: #888;">Select a file or folder to view its design document.</div>`;
            return;
        }

        this.shadow.innerHTML = `
            <link rel="stylesheet" href="styles/detail.css">
            <div class="detail-loading" style="padding: 20px;">Loading...</div>
        `;

        const content = this.fetchDesignDoc(selectedPath, selectedType);

        if (content) {
            this.shadow.innerHTML = `
                <link rel="stylesheet" href="styles/detail.css">
                <div class="detail-view">
                    ${content}
                </div>
            `;
        } else {
            this.shadow.innerHTML = `
                <link rel="stylesheet" href="styles/detail.css">
                <div class="detail-empty">There is no design file for this selection.</div>
            `;
        }
    }

    /**
     * Fetch design doc content from the loaded docs.
     * Tries various path patterns to find a match.
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
