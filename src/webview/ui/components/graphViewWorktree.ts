/**
 * Pure worktree tree-walks for `GraphView`.
 *
 * Extracted from `components/GraphView.ts` (Loop 22 file-size split).
 * Pure browser code — no node/vscode imports.
 *
 * These walks take the worktree root explicitly instead of reading
 * `this.worktree`, so they are plain functions with no component state.
 */

import { WorkTreeNode, DirectoryNode } from "../types";

/** Find the node with the given path in the worktree, or `undefined`. */
export function findNode(node: WorkTreeNode, path: string): WorkTreeNode | undefined {
    if (node.path === path) return node;
    if (node.type === 'directory' && (node as DirectoryNode).children) {
        for (const child of (node as DirectoryNode).children) {
            const found = findNode(child, path);
            if (found) return found;
        }
    }
    return undefined;
}

/** Collect every file path under `dirNode` (inclusive) into a Set. */
export function collectSubtreeFiles(dirNode: WorkTreeNode): Set<string> {
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
