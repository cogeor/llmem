/**
 * Service to load worktree and perform tree operations
 */
export class WorktreeService {
    constructor() {
        this.tree = null;
        this.index = new Map(); // path -> node
    }

    async load() {
        if (this.tree) return this.tree;

        // window.WORK_TREE is injected
        if (window.WORK_TREE) {
            this.tree = window.WORK_TREE;
            this._buildIndex(this.tree);
        } else {
            console.warn("No WORK_TREE found in window");
            this.tree = { name: "root", path: "", type: "directory", children: [] };
        }
        return this.tree;
    }

    getNode(path) {
        return this.index.get(path);
    }

    _buildIndex(node) {
        if (!node) return;
        this.index.set(node.path, node);
        if (node.children) {
            node.children.forEach(c => this._buildIndex(c));
        }
    }

    /**
     * Recursively collect all files in a subtree
     * @param {Object} dirNode 
     * @returns {Set<string>} Set of file paths
     */
    collectSubtreeFiles(dirNode) {
        const files = new Set();
        const walk = (node) => {
            if (!node) return;
            if (node.type === "file") {
                files.add(node.path);
            } else if (node.type === "directory" && node.children) {
                node.children.forEach(walk);
            }
        };
        walk(dirNode);
        return files;
    }
}
