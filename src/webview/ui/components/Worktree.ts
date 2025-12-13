
import { WorktreeService } from '../services/worktreeService';
import { WorkTreeNode, DirectoryNode, AppState } from '../types';

interface Props {
    el: HTMLElement;
    state: any; // State class
    worktreeService: WorktreeService;
}

export class Worktree {
    private el: HTMLElement;
    private state: any;
    private worktreeService: WorktreeService;
    private unsubscribe?: () => void;

    constructor({ el, state, worktreeService }: Props) {
        this.el = el;
        this.state = state;
        this.worktreeService = worktreeService;
    }

    async mount() {
        const tree = await this.worktreeService.load();
        this.render(tree);

        // Listen for clicks
        this.el.addEventListener('click', (e) => this.handleClick(e));

        // Subscribe to state to update selection highlight
        this.unsubscribe = this.state.subscribe((s: AppState) => this.updateSelection(s));
    }

    render(rootNode: WorkTreeNode) {
        this.el.innerHTML = `<ul class="tree-list">${this.renderNode(rootNode, 0)}</ul>`;
    }

    renderNode(node: WorkTreeNode, depth: number): string {
        const isDir = node.type === 'directory';

        let html = `
            <li class="tree-node" data-path="${node.path}" data-type="${node.type}">
                <div class="tree-item" style="padding-left: ${depth * 12 + 12}px">
                    <span class="tree-arrow">${isDir ? '' : ''}</span>
                    <span class="icon">${isDir ? '📁' : '📄'}</span>
                    <span class="label">${node.name}</span>
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
            selectedType: type
        });
    }

    updateSelection({ selectedPath }: AppState) {
        // Remove old selection
        const prev = this.el.querySelector('.tree-item.is-selected');
        if (prev) prev.classList.remove('is-selected');

        if (selectedPath) {
            const nodeEl = this.el.querySelector(`.tree-node[data-path="${CSS.escape(selectedPath)}"]`);
            if (nodeEl) {
                const item = nodeEl.querySelector('.tree-item');
                item?.classList.add('is-selected');

                let parent = nodeEl.parentElement?.closest('.tree-children');
                while (parent) {
                    parent.classList.add('is-expanded');
                    const parentNodeLi = parent.parentElement;
                    const parentItem = parentNodeLi?.querySelector('.tree-item');
                    if (parentItem) parentItem.setAttribute('aria-expanded', 'true');

                    parent = parent.parentElement?.closest('.tree-children');
                }
            }
        }
    }
}
