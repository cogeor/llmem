
import { WorkTreeNode, DirectoryNode, FileNode } from '../types';

export class WorktreeService {
    private tree: WorkTreeNode | null = null;
    private index: Map<string, WorkTreeNode> = new Map();

    async load(): Promise<WorkTreeNode> {
        if (this.tree) return this.tree;

        if (window.WORK_TREE) {
            this.tree = window.WORK_TREE;
            this._buildIndex(this.tree);
        } else {
            console.warn("No WORK_TREE found in window");
            this.tree = { name: "root", path: "", type: "directory", children: [] } as DirectoryNode;
        }
        return this.tree;
    }

    getNode(path: string): WorkTreeNode | undefined {
        return this.index.get(path);
    }

    private _buildIndex(node: WorkTreeNode) {
        if (!node) return;
        this.index.set(node.path, node);
        if (node.type === 'directory' && (node as DirectoryNode).children) {
            (node as DirectoryNode).children.forEach(c => this._buildIndex(c));
        }
    }

    /**
     * Recursively collect all files in a subtree
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
