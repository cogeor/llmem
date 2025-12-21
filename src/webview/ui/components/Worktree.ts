
import { DataProvider } from '../services/dataProvider';
import { WorkTreeNode, DirectoryNode, AppState, GraphStatus } from '../types';

// VS Code webview API type declaration
declare function acquireVsCodeApi(): { postMessage: (message: any) => void };

interface Props {
    el: HTMLElement;
    state: any; // State class
    dataProvider: DataProvider;
}

/**
 * Get status color for a graph status.
 */
function getStatusColor(status: GraphStatus | undefined): string {
    switch (status) {
        case 'current': return '#22c55e';   // Green
        case 'outdated': return '#f97316';  // Orange
        case 'never': return '#ef4444';     // Red
        default: return '#6b7280';          // Gray (unknown)
    }
}

/**
 * Get combined status (worst of import/call).
 */
function getCombinedStatus(importStatus?: GraphStatus, callStatus?: GraphStatus): GraphStatus {
    if (importStatus === 'never' || callStatus === 'never') return 'never';
    if (importStatus === 'outdated' || callStatus === 'outdated') return 'outdated';
    if (importStatus === 'current' && callStatus === 'current') return 'current';
    return 'never'; // Default if unknown
}

/**
 * Worktree Component
 * Displays the file system tree and handles selection.
 */
export class Worktree {
    private el: HTMLElement;
    private state: any;
    private dataProvider: DataProvider;
    private tree: WorkTreeNode | null = null;
    private unsubscribe?: () => void;
    private vscodeApi: any = null;

    constructor({ el, state, dataProvider }: Props) {
        this.el = el;
        this.state = state;
        this.dataProvider = dataProvider;

        // Get VS Code API from the shared data provider
        this.vscodeApi = dataProvider.getVscodeApi();
    }

    private clickHandlerBound: boolean = false;

    async mount() {
        this.tree = await this.dataProvider.loadWorkTree();
        this.render(this.tree);

        // Listen for clicks (only add once)
        if (!this.clickHandlerBound) {
            this.el.addEventListener('click', (e) => this.handleClick(e));
            this.clickHandlerBound = true;
        }

        // Subscribe to state to update selection highlight and watched buttons
        this.unsubscribe = this.state.subscribe((s: AppState) => {
            this.updateSelection(s);
            this.updateWatchedButtons(s.watchedPaths);
        });
    }

    render(rootNode: WorkTreeNode) {
        this.el.innerHTML = `<ul class="tree-list">${this.renderNode(rootNode, 0)}</ul>`;
    }

    /**
     * Check if a file is parsable based on extension.
     */
    isParsableFile(filename: string): boolean {
        const ext = '.' + filename.split('.').pop()?.toLowerCase();
        const parsableExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.hpp'];
        return parsableExtensions.includes(ext);
    }

    renderNode(node: WorkTreeNode, depth: number): string {
        const isDir = node.type === 'directory';

        // Check if we should show toggle button (always for dirs, only for parsable files)
        const showToggle = isDir || this.isParsableFile(node.name);
        const statusTitle = showToggle
            ? `Click to toggle file watching for this ${isDir ? 'folder' : 'file'}.`
            : '';

        let html = `
            <li class="tree-node" data-path="${node.path}" data-type="${node.type}">
                <div class="tree-item" style="padding-left: ${depth * 12 + 12}px">
                    ${isDir ? '<span class="tree-arrow"></span>' : ''}
                    <span class="icon">${isDir ? '📁' : '📄'}</span>
                    <span class="label">${node.name}</span>
                    ${showToggle ? `<button class="status-btn" data-path="${node.path}" title="${statusTitle}" onclick="event.stopPropagation(); event.preventDefault();" style="
                        width: 12px;
                        height: 12px;
                        min-width: 12px;
                        min-height: 12px;
                        box-sizing: border-box;
                        border-radius: 50%;
                        border: none;
                        background-color: #ccc;
                        margin-left: auto;
                        cursor: pointer;
                        flex-shrink: 0;
                    "></button>` : ''}
                </div>
        `;

        if (isDir && (node as DirectoryNode).children) {
            html += `<ul class="tree-children" data-path="${node.path}">`;
            (node as DirectoryNode).children.forEach(child => {
                html += this.renderNode(child, depth + 1);
            });
            html += `</ul>`;
        }

        html += `</li>`;
        return html;
    }

    handleClick(e: Event) {
        const target = e.target as HTMLElement;

        // Check if status button was clicked - prevent any other action
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
        const type = nodeEl.dataset.type;

        if (type === 'directory') {
            // Toggle expansion
            const childrenUl = nodeEl.querySelector('.tree-children');
            if (childrenUl) {
                const isExpanded = childrenUl.classList.contains('is-expanded');
                childrenUl.classList.toggle('is-expanded');
                item.setAttribute('aria-expanded', String(!isExpanded));
            }
        }


        // Update selection state
        this.state.set({
            selectedPath: path,
            selectedType: type,
            selectionSource: 'explorer'
        });
    }

    /**
     * Handle status button click - toggle watch state for the path and all children.
     */
    handleStatusButtonClick(path: string) {
        const currentState = this.state.get();
        const isCurrentlyWatched = currentState.watchedPaths.has(path);
        const newWatchedPaths = new Set<string>(currentState.watchedPaths);

        // Collect all paths to toggle (the clicked path + all children)
        const pathsToToggle = this.collectAllPaths(path);

        if (isCurrentlyWatched) {
            // Unwatch all paths
            for (const p of pathsToToggle) {
                newWatchedPaths.delete(p);
            }
            console.log(`[Worktree] Unwatching ${pathsToToggle.length} paths under: ${path}`);
        } else {
            // Watch all paths
            for (const p of pathsToToggle) {
                newWatchedPaths.add(p);
            }
            console.log(`[Worktree] Watching ${pathsToToggle.length} paths under: ${path}`);
        }

        // Update local state
        this.state.set({ watchedPaths: newWatchedPaths });

        // Update button color immediately
        this.updateWatchedButtons(newWatchedPaths);

        // Send message to VS Code extension
        if (this.vscodeApi) {
            this.vscodeApi.postMessage({
                type: 'toggleWatch',
                path: path,
                watched: !isCurrentlyWatched
            });
        }
    }

    /**
     * Collect all paths under a given path (including the path itself).
     */
    collectAllPaths(path: string): string[] {
        const paths: string[] = [path];

        // Find all status buttons with paths that start with this path
        const buttons = this.el.querySelectorAll('.status-btn');
        buttons.forEach(btn => {
            const btnPath = (btn as HTMLElement).dataset.path;
            if (btnPath && btnPath !== path && btnPath.startsWith(path + '/')) {
                paths.push(btnPath);
            }
        });

        return paths;
    }

    /**
     * Update toggle button colors based on watched state.
     */
    updateWatchedButtons(watchedPaths: Set<string>) {
        const buttons = this.el.querySelectorAll('.status-btn');
        buttons.forEach(btn => {
            const path = (btn as HTMLElement).dataset.path;
            if (path) {
                const isWatched = watchedPaths.has(path);
                (btn as HTMLElement).style.backgroundColor = isWatched ? '#4ade80' : '#ccc';
            }
        });
    }

    updateSelection({ selectedPath, selectionSource }: AppState) {
        // Remove old selection
        const prev = this.el.querySelector('.tree-item.is-selected');
        if (prev) prev.classList.remove('is-selected');

        if (selectedPath) {
            const nodeEl = this.el.querySelector(`.tree-node[data-path="${CSS.escape(selectedPath)}"]`);
            if (nodeEl) {
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
        }
    }

    /**
     * Get a node by path from the loaded tree
     */
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

    /**
     * Collect all file paths in a subtree
     */
    collectSubtreeFiles(dirNode: WorkTreeNode): Set<string> {
        const files = new Set<string>();
        const walk = (node: WorkTreeNode) => {
            if (!node) return;
            if (node.type === "file") {
                files.add(node.path);
            } else if (node.type === "directory" && (node as DirectoryNode).children) {
                (node as DirectoryNode).children.forEach(walk);
            }
        };
        walk(dirNode);
        return files;
    }
}
