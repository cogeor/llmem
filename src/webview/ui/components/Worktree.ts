
import { DataProvider } from '../services/dataProvider';
import { WorkTreeNode, DirectoryNode, AppState, GraphStatus } from '../types';
import { isSupportedFile } from '../../../parser/config';
import { folder, file, chevronRight } from '../icons';

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

    constructor({ el, state, dataProvider }: Props) {
        this.el = el;
        this.state = state;
        this.dataProvider = dataProvider;
    }

    private clickHandlerBound: boolean = false;

    async mount() {
        this.tree = await this.dataProvider.loadWorkTree();
        this.render(this.tree);

        // Restore expansion state from previous session
        this.restoreExpansionState();

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
        return isSupportedFile(filename);
    }

    /**
     * Check if a directory contains any parsable files (recursively).
     */
    hasAnyParsableFiles(dirNode: WorkTreeNode): boolean {
        if (dirNode.type === 'file') {
            return this.isParsableFile(dirNode.name);
        }

        if (dirNode.type === 'directory' && (dirNode as DirectoryNode).children) {
            for (const child of (dirNode as DirectoryNode).children) {
                if (this.hasAnyParsableFiles(child)) {
                    return true;
                }
            }
        }

        return false;
    }

    renderNode(node: WorkTreeNode, depth: number): string {
        const isDir = node.type === 'directory';

        // Check if we should show toggle button:
        // - For files: only if parsable
        // - For dirs: only if contains parsable files (recursively)
        const showToggle = isDir
            ? this.hasAnyParsableFiles(node)
            : this.isParsableFile(node.name);
        const statusTitle = showToggle
            ? `Click to toggle file watching for this ${isDir ? 'folder' : 'file'}.`
            : '';

        let html = `
            <li class="tree-node" data-path="${node.path}" data-type="${node.type}">
                <div class="tree-item" style="padding-left: ${depth * 12 + 12}px">
                    ${isDir ? `<span class="tree-arrow">${chevronRight}</span>` : ''}
                    <span class="icon">${isDir ? folder : file}</span>
                    <span class="label">${node.name}</span>
                    ${showToggle ? `<button class="status-btn" data-path="${node.path}" title="${statusTitle}" style="
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

                // Save expansion state
                this.saveExpansionState();
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
     * Save current tree expansion state to localStorage (HTTP mode only).
     */
    private saveExpansionState(): void {
        // Only save in HTTP mode (not VSCode) - VS Code handles state differently
        if (this.dataProvider.getVscodeApi()) return;

        const expandedPaths: string[] = [];
        const expandedElements = this.el.querySelectorAll('.tree-children.is-expanded');
        expandedElements.forEach(el => {
            const path = (el as HTMLElement).dataset.path;
            if (path) expandedPaths.push(path);
        });

        try {
            localStorage.setItem('llmem:expandedPaths', JSON.stringify(expandedPaths));
        } catch (e) {
            console.warn('[Worktree] Failed to save expansion state:', e);
        }
    }

    /**
     * Restore tree expansion state from localStorage (HTTP mode only).
     */
    private restoreExpansionState(): void {
        // Only restore in HTTP mode (not VSCode) - VS Code handles state differently
        if (this.dataProvider.getVscodeApi()) return;

        try {
            const saved = localStorage.getItem('llmem:expandedPaths');
            if (!saved) return;

            const expandedPaths = JSON.parse(saved) as string[];
            for (const path of expandedPaths) {
                const childrenEl = this.el.querySelector(`.tree-children[data-path="${CSS.escape(path)}"]`);
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
            console.warn('[Worktree] Failed to restore expansion state:', e);
        }
    }

    /**
     * Handle status button click - toggle watch state for the path.
     * Uses DataProvider abstraction for mode-agnostic toggle.
     */
    async handleStatusButtonClick(clickedPath: string) {
        const currentState = this.state.get();
        const nodeEl = this.el.querySelector(`.tree-node[data-path="${CSS.escape(clickedPath)}"]`) as HTMLElement;
        const isDir = nodeEl?.dataset.type === 'directory';

        // Determine if currently watched:
        // - For files: exact match in watchedPaths
        // - For folders: any descendant file is watched
        let isCurrentlyWatched: boolean;
        if (isDir) {
            isCurrentlyWatched = this.hasWatchedDescendant(clickedPath, currentState.watchedPaths);
        } else {
            isCurrentlyWatched = currentState.watchedPaths.has(clickedPath);
        }

        const newWatchedState = !isCurrentlyWatched;
        console.log(`[Worktree] Toggle ${isDir ? 'folder' : 'file'}: ${clickedPath} -> ${newWatchedState}`);

        // Show loading indicator on button
        const btn = nodeEl?.querySelector('.status-btn') as HTMLElement;
        if (btn) {
            btn.style.opacity = '0.5';
            btn.style.cursor = 'wait';
        }

        try {
            // Use abstracted toggleWatch - works in both VS Code and standalone mode
            const response = await this.dataProvider.toggleWatch(clickedPath, newWatchedState);

            console.log(`[Worktree] Toggle response:`, response);

            // Update local state with the affected files
            const updatedPaths = new Set(currentState.watchedPaths);
            const affectedFiles = newWatchedState ? response.addedFiles : response.removedFiles;

            if (affectedFiles) {
                for (const file of affectedFiles) {
                    if (newWatchedState) {
                        updatedPaths.add(file);
                    } else {
                        updatedPaths.delete(file);
                    }
                }
            }

            // Update state (this will trigger button color updates)
            this.state.set({ watchedPaths: updatedPaths });
        } catch (error) {
            console.error(`[Worktree] Failed to toggle watch:`, error);
            alert(`Failed to toggle watch: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            // Reset button appearance
            if (btn) {
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
            }
        }
    }

    /**
     * Collect all file paths under a given path (for local operations).
     */
    collectAllFilePaths(folderPath: string): string[] {
        const filePaths: string[] = [];
        const buttons = this.el.querySelectorAll('.status-btn');
        buttons.forEach(btn => {
            const btnPath = (btn as HTMLElement).dataset.path;
            const nodeEl = btn.closest('.tree-node') as HTMLElement;
            const isFile = nodeEl?.dataset.type === 'file';
            if (btnPath && isFile && btnPath.startsWith(folderPath + '/')) {
                filePaths.push(btnPath);
            }
        });
        return filePaths;
    }

    /**
     * Update toggle button colors based on watched state.
     * With file-only tracking:
     * - Files: exact match in watchedPaths (which are now file paths)
     * - Folders: watched only if ALL parsable files under it are watched
     */
    updateWatchedButtons(watchedFiles: Set<string>) {
        const buttons = this.el.querySelectorAll('.status-btn');
        buttons.forEach(btn => {
            const btnPath = (btn as HTMLElement).dataset.path;
            const nodeEl = btn.closest('.tree-node') as HTMLElement;
            const isDir = nodeEl?.dataset.type === 'directory';

            if (btnPath) {
                let isWatched: boolean;
                if (isDir) {
                    // Folder: check if ALL files under it are watched
                    isWatched = this.areAllDescendantsWatched(btnPath, watchedFiles);
                } else {
                    // File: exact match
                    isWatched = watchedFiles.has(btnPath);
                }
                (btn as HTMLElement).style.backgroundColor = isWatched ? '#4ade80' : '#ccc';
            }
        });
    }

    /**
     * Check if ALL parsable files under a folder path are watched.
     * Returns false if there are no files, or if any file is not watched.
     */
    private areAllDescendantsWatched(folderPath: string, watchedFiles: Set<string>): boolean {
        // Get all file buttons under this folder
        const descendantFiles = this.collectAllFilePaths(folderPath);

        // If no files, folder is not "watched"
        if (descendantFiles.length === 0) {
            return false;
        }

        // Check if ALL files are watched
        for (const filePath of descendantFiles) {
            if (!watchedFiles.has(filePath)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Check if ANY file under a folder path is watched.
     * Used for toggle detection (to know if there's something to untoggle).
     */
    private hasWatchedDescendant(folderPath: string, watchedFiles: Set<string>): boolean {
        const descendantFiles = this.collectAllFilePaths(folderPath);
        for (const filePath of descendantFiles) {
            if (watchedFiles.has(filePath)) {
                return true;
            }
        }
        return false;
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
