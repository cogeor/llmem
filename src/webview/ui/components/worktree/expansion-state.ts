/**
 * Expansion-state persistence for the Worktree component.
 *
 * Loop 16 — extracted from `Worktree.ts`. Persists the set of
 * currently-expanded `data-path` values to localStorage so the tree
 * survives reloads in browser/HTTP mode. No-op in VS Code mode (the
 * webview host persists panel state separately).
 */

import type { WebviewLogger } from '../../services/webview-logger';
import type { HostKind } from '../../services/dataProvider';

export interface ExpansionStateProps {
    /** Mirrors `DataProvider.hostKind` (`'vscode' | 'browser'`). */
    readonly hostKind: HostKind;
    /** Optional logger for save/restore failure paths. */
    readonly logger?: WebviewLogger;
    /**
     * localStorage key. Defaults to `'llmem:expandedPaths'` — the
     * literal used pre-loop-16. Overridable so tests can use a
     * namespaced key without polluting real localStorage.
     */
    readonly storageKey?: string;
}

const DEFAULT_STORAGE_KEY = 'llmem:expandedPaths';

export class ExpansionStatePersister {
    private readonly hostKind: HostKind;
    private readonly logger?: WebviewLogger;
    private readonly storageKey: string;

    constructor(props: ExpansionStateProps) {
        this.hostKind = props.hostKind;
        this.logger = props.logger;
        this.storageKey = props.storageKey ?? DEFAULT_STORAGE_KEY;
    }

    /**
     * Read the set of currently-expanded `data-path` values from
     * `rootEl` and persist them. No-op in vscode mode.
     */
    save(rootEl: HTMLElement): void {
        // Only save in HTTP (browser) mode — VS Code persists panel
        // state separately, and the static review forbids components
        // from reaching into the host API directly (Loop 14).
        if (this.hostKind === 'vscode') return;

        const expandedPaths: string[] = [];
        const expandedElements = rootEl.querySelectorAll('.tree-children.is-expanded');
        expandedElements.forEach(el => {
            const path = (el as HTMLElement).dataset.path;
            if (path) expandedPaths.push(path);
        });

        try {
            localStorage.setItem(this.storageKey, JSON.stringify(expandedPaths));
        } catch (e) {
            this.logger?.warn('[Worktree] Failed to save expansion state:', e);
        }
    }

    /**
     * Read the persisted set and apply `is-expanded` classes to
     * matching `.tree-children[data-path=...]` elements under
     * `rootEl`. No-op in vscode mode.
     */
    restore(rootEl: HTMLElement): void {
        if (this.hostKind === 'vscode') return;

        try {
            const saved = localStorage.getItem(this.storageKey);
            if (!saved) return;

            const expandedPaths = JSON.parse(saved) as string[];
            for (const path of expandedPaths) {
                const childrenEl = rootEl.querySelector(
                    `.tree-children[data-path="${CSS.escape(path)}"]`,
                );
                if (childrenEl) {
                    childrenEl.classList.add('is-expanded');
                    const parentNodeLi = childrenEl.parentElement;
                    const parentItem = parentNodeLi?.querySelector('.tree-item');
                    if (parentItem) {
                        parentItem.setAttribute('aria-expanded', 'true');
                    }
                }
            }
        } catch (e) {
            this.logger?.warn('[Worktree] Failed to restore expansion state:', e);
        }
    }
}
