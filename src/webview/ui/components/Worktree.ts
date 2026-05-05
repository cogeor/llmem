
import { DataProvider } from '../services/dataProvider';
import { State } from '../state';
import { WorkTreeNode, DirectoryNode, AppState } from '../types';
import { WebviewLogger, createWebviewLogger } from '../services/webview-logger';
import { TreeHtmlRenderer } from './worktree/tree-html-renderer';
import {
    WatchStateCalculator,
    createWatchStateCalculator,
} from './worktree/watch-state';
import { ExpansionStatePersister } from './worktree/expansion-state';

interface Props {
    el: HTMLElement;
    state: State;
    dataProvider: DataProvider;
    logger?: WebviewLogger;
}

/**
 * Worktree Component
 *
 * Loop 16 — orchestration only. Tree HTML rendering, watch-state
 * derivation, and expansion-state persistence each live in their own
 * unit under `components/worktree/`. This file owns: mount, click
 * dispatch, selection-highlight, and the data-load lifecycle.
 */
export class Worktree {
    private el: HTMLElement;
    private state: State;
    private dataProvider: DataProvider;
    private tree: WorkTreeNode | null = null;
    private unsubscribe?: () => void;
    private logger: WebviewLogger;

    private readonly htmlRenderer: TreeHtmlRenderer;
    private readonly watchState: WatchStateCalculator;
    private readonly expansion: ExpansionStatePersister;

    constructor({ el, state, dataProvider, logger }: Props) {
        this.el = el;
        this.state = state;
        this.dataProvider = dataProvider;
        this.logger = logger ?? createWebviewLogger({ enabled: false });
        this.htmlRenderer = new TreeHtmlRenderer();
        this.watchState = createWatchStateCalculator();
        this.expansion = new ExpansionStatePersister({
            hostKind: dataProvider.hostKind,
            logger: this.logger,
        });
    }

    private clickHandlerBound: boolean = false;

    async mount() {
        this.tree = await this.dataProvider.loadWorkTree();
        this.render(this.tree);

        // Restore expansion state from previous session
        this.expansion.restore(this.el);

        // Listen for clicks (only add once)
        if (!this.clickHandlerBound) {
            this.el.addEventListener('click', (e) => this.handleClick(e));
            this.clickHandlerBound = true;
        }

        // Subscribe to state to update selection highlight + watched buttons
        this.unsubscribe = this.state.subscribe((s: AppState) => {
            this.updateSelection(s);
            this.watchState.updateButtons(this.el, s.watchedPaths);
        });
    }

    render(rootNode: WorkTreeNode) {
        // safe: TreeHtmlRenderer escapes every filesystem-derived
        // interpolation (path, name) via utils/escape; structural
        // tags and CSS class names are static.
        this.el.innerHTML = `<ul class="tree-list">${this.htmlRenderer.render(rootNode)}</ul>`;
    }

    handleClick(e: Event) {
        const target = e.target as HTMLElement;

        // Status button click — short-circuit any other action.
        if (target.classList.contains('status-btn')) {
            e.stopPropagation();
            e.preventDefault();
            const path = target.dataset.path || '';
            this.handleStatusButtonClick(path);
            return;
        }

        const item = target.closest('.tree-item');
        if (!item) return;

        const nodeEl = item.parentElement as HTMLElement;
        const path = nodeEl.dataset.path;
        const rawType = nodeEl.dataset.type;
        // Loop 14: tighten — `data-type` is rendered from a controlled
        // union, but `dataset.*` is `string | undefined` at the type
        // system. Narrow by check.
        const type: 'file' | 'directory' | null =
            rawType === 'file' || rawType === 'directory' ? rawType : null;

        if (type === 'directory') {
            const childrenUl = nodeEl.querySelector('.tree-children');
            if (childrenUl) {
                const isExpanded = childrenUl.classList.contains('is-expanded');
                childrenUl.classList.toggle('is-expanded');
                item.setAttribute('aria-expanded', String(!isExpanded));
                this.expansion.save(this.el);
            }
        }

        // Update selection state
        this.state.set({
            selectedPath: path ?? null,
            selectedType: type,
            selectionSource: 'explorer',
        });
    }

    /**
     * Handle status button click — toggle watch state for the path.
     * Uses DataProvider abstraction for mode-agnostic toggle.
     */
    async handleStatusButtonClick(clickedPath: string) {
        const currentState = this.state.get();
        const nodeEl = this.el.querySelector(
            `.tree-node[data-path="${CSS.escape(clickedPath)}"]`,
        ) as HTMLElement;
        const isDir = nodeEl?.dataset.type === 'directory';

        // Determine if currently watched:
        // - For files: exact match in watchedPaths
        // - For folders: any descendant file is watched
        const isCurrentlyWatched = isDir
            ? this.watchState.hasWatchedDescendant(this.el, clickedPath, currentState.watchedPaths)
            : currentState.watchedPaths.has(clickedPath);
        const newWatchedState = !isCurrentlyWatched;
        this.logger.log(`[Worktree] Toggle ${isDir ? 'folder' : 'file'}: ${clickedPath} -> ${newWatchedState}`);

        // Show loading indicator on button
        const btn = nodeEl?.querySelector('.status-btn') as HTMLElement;
        if (btn) {
            btn.style.opacity = '0.5';
            btn.style.cursor = 'wait';
        }

        try {
            const response = await this.dataProvider.toggleWatch(clickedPath, newWatchedState);
            this.logger.log(`[Worktree] Toggle response:`, response);

            const updatedPaths = new Set(currentState.watchedPaths);
            const affectedFiles = newWatchedState ? response.addedFiles : response.removedFiles;
            if (affectedFiles) {
                for (const file of affectedFiles) {
                    if (newWatchedState) updatedPaths.add(file);
                    else updatedPaths.delete(file);
                }
            }
            this.state.set({ watchedPaths: updatedPaths });
        } catch (error) {
            this.logger.error(`[Worktree] Failed to toggle watch:`, error);
            alert(`Failed to toggle watch: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            if (btn) {
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
            }
        }
    }

    updateSelection({ selectedPath, selectionSource }: AppState) {
        const prev = this.el.querySelector('.tree-item.is-selected');
        if (prev) prev.classList.remove('is-selected');
        if (!selectedPath) return;

        const nodeEl = this.el.querySelector(
            `.tree-node[data-path="${CSS.escape(selectedPath)}"]`,
        );
        if (!nodeEl) return;

        const item = nodeEl.querySelector('.tree-item');
        item?.classList.add('is-selected');

        // Expand parent folders
        let parent = nodeEl.parentElement?.closest('.tree-children');
        while (parent) {
            parent.classList.add('is-expanded');
            const parentNodeLi = parent.parentElement;
            const parentItem = parentNodeLi?.querySelector('.tree-item');
            if (parentItem) parentItem.setAttribute('aria-expanded', 'true');
            parent = parent.parentElement?.closest('.tree-children');
        }

        // Scroll into view when selection comes from graph
        if (selectionSource === 'graph' && item) {
            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    /** Get a node by path from the loaded tree. */
    getNode(path: string): WorkTreeNode | undefined {
        if (!this.tree) return undefined;
        return this.findNode(this.tree, path);
    }

    private findNode(node: WorkTreeNode, path: string): WorkTreeNode | undefined {
        if (node.path === path) return node;
        if (node.type === 'directory' && (node as DirectoryNode).children) {
            for (const child of (node as DirectoryNode).children) {
                const found = this.findNode(child, path);
                if (found) return found;
            }
        }
        return undefined;
    }

    /** Collect all file paths in a subtree. */
    collectSubtreeFiles(dirNode: WorkTreeNode): Set<string> {
        const files = new Set<string>();
        const walk = (node: WorkTreeNode) => {
            if (!node) return;
            if (node.type === 'file') {
                files.add(node.path);
            } else if (node.type === 'directory' && (node as DirectoryNode).children) {
                (node as DirectoryNode).children.forEach(walk);
            }
        };
        walk(dirNode);
        return files;
    }
}
