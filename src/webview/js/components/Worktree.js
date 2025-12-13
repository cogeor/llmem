/**
 * Worktree Component
 */
export class Worktree {
    constructor({ el, state, worktreeService }) {
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
        this.unsubscribe = this.state.subscribe((s) => this.updateSelection(s));
    }

    render(rootNode) {
        this.el.innerHTML = `<ul class="tree-list">${this.renderNode(rootNode, 0)}</ul>`;
    }

    renderNode(node, depth) {
        const isDir = node.type === 'directory';
        // Padding is handled by CSS or nesting? Design doc said "Indentation by depth".
        // Let's use simple padding-left style here for simplicity, or nested uls.
        // Using nested uls is more semantic but requires recursion structure in HTML.
        // Let's use a flat list with padding for performance if tree is huge, but recursive is easier to implement for "collapse".

        // We'll use recursive `<ul>` structure.

        let html = `
            <li class="tree-node" data-path="${node.path}" data-type="${node.type}">
                <div class="tree-item" style="padding-left: ${depth * 12 + 12}px">
                    <span class="tree-arrow">${isDir ? '' : ''}</span>
                    <span class="icon">${isDir ? '📁' : '📄'}</span>
                    <span class="label">${node.name}</span>
                </div>
        `;

        if (isDir && node.children) {
            html += `<ul class="tree-children" data-path="${node.path}">`;
            node.children.forEach(child => {
                html += this.renderNode(child, depth + 1);
            });
            html += `</ul>`;
        }

        html += `</li>`;
        return html;
    }

    handleClick(e) {
        const item = e.target.closest('.tree-item');
        if (!item) return;

        const nodeEl = item.parentElement;
        const path = nodeEl.dataset.path;
        const type = nodeEl.dataset.type;

        if (type === 'directory') {
            // Toggle expansion
            const childrenUl = nodeEl.querySelector('.tree-children');
            if (childrenUl) {
                const isExpanded = childrenUl.classList.contains('is-expanded');
                childrenUl.classList.toggle('is-expanded');
                item.setAttribute('aria-expanded', !isExpanded);

                // Track expansion state if needed in global state (optional for purely visual toggle, but good for persistence)
                // For now, local toggle is fine, but we also select directories.
            }
        }

        // Update selection state
        this.state.set({
            selectedPath: path,
            selectedType: type
        });
    }

    updateSelection({ selectedPath }) {
        // Remove old selection
        const prev = this.el.querySelector('.tree-item.is-selected');
        if (prev) prev.classList.remove('is-selected');

        if (selectedPath) {
            // Find new selection
            // We need to escape special chars in selector if path has them
            // Simplest is to find by data attribute
            const nodeEl = this.el.querySelector(`.tree-node[data-path="${CSS.escape(selectedPath)}"]`);
            if (nodeEl) {
                const item = nodeEl.querySelector('.tree-item');
                item.classList.add('is-selected');

                // Ensure parents are expanded?
                // Optional QoL feature
                let parent = nodeEl.parentElement.closest('.tree-children');
                while (parent) {
                    parent.classList.add('is-expanded');
                    // Also rotate arrows of parents
                    const parentNodeLi = parent.parentElement;
                    const parentItem = parentNodeLi.querySelector('.tree-item');
                    if (parentItem) parentItem.setAttribute('aria-expanded', 'true');

                    parent = parent.parentElement.closest('.tree-children');
                }
            }
        }
    }
}
