/**
 * FolderDescriptionPanel — README rendering for the selected folder
 * (Loop 15 split).
 *
 * Owns `.package-description-panel`. Resolves the folder's README via
 * the pure `resolveReadmeDoc` helper (`folderViewModel.ts`); on hit,
 * mounts a `DesignRender` instance in `view` mode; on miss, shows the
 * `llmem document <path>` empty-state suggestion.
 *
 * Pinned by `tests/unit/web-viewer/package-view-description.test.ts`.
 */

import type { DesignDoc } from '../types';
import { escape } from '../utils/escape';
import { DesignRender } from './DesignRender';
import { WebviewLogger, createWebviewLogger } from '../services/webview-logger';
import { resolveReadmeDoc } from './folderViewModel';

export interface FolderDescriptionPanelProps {
    /** `<div class="package-description-panel">` mount point. */
    el: HTMLElement;
    designDocs: Record<string, DesignDoc>;
    logger?: WebviewLogger;
}

export class FolderDescriptionPanel {
    private readonly props: FolderDescriptionPanelProps;
    private readonly logger: WebviewLogger;

    private designDocs: Record<string, DesignDoc>;
    /** Current renderer instance; null when no doc is shown. */
    private renderer: DesignRender | null = null;

    constructor(props: FolderDescriptionPanelProps) {
        this.props = props;
        this.designDocs = props.designDocs;
        this.logger = props.logger ?? createWebviewLogger({ enabled: false });
    }

    /**
     * Resolve the README for `folderPath` and render it (or the empty-
     * state suggestion if no doc exists).
     */
    show(folderPath: string): void {
        const doc = resolveReadmeDoc(this.designDocs, folderPath);
        if (doc === null) {
            const safePath = escape(folderPath);
            // safe: structural template; safePath is escape()-wrapped;
            // surrounding strings are author-controlled literals.
            this.props.el.innerHTML =
                `<div class="package-description-empty">` +
                `No design doc yet — run <code>llmem document ${safePath}</code>.` +
                `</div>`;
            this.props.el.style.display = 'block';
            this.renderer = null;
            return;
        }
        // Use DesignRender in 'view' mode — the package view is read-only
        // (onModeChange is a no-op, onSave is omitted).
        this.renderer = new DesignRender({
            markdown: doc.markdown,
            html: doc.html,
            mode: 'view',
            onModeChange: () => {
                /* no-op: package view is read-only */
            },
        });
        this.props.el.innerHTML = '';
        this.props.el.style.display = 'block';
        this.renderer.mount(this.props.el);
        // Logger reference kept for parity with sibling components — future
        // debug surfaces can route here without a constructor-shape change.
        void this.logger;
    }

    hide(): void {
        this.props.el.style.display = 'none';
        this.props.el.innerHTML = '';
        this.renderer = null;
    }

    /**
     * Replace the in-memory designDocs map (e.g. when the orchestrator
     * receives a websocket update). Does not re-render — callers decide
     * when to call `show` again.
     */
    setDesignDocs(docs: Record<string, DesignDoc>): void {
        this.designDocs = docs;
    }

    unmount(): void {
        this.hide();
    }
}
