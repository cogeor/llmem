/**
 * Folder-tree internals for `HierarchicalLayout`.
 *
 * Loop 16 — extracted from `HierarchicalLayout.ts` to keep the engine
 * file under the 400-line budget. The `FolderNode` interface stays
 * internal to the layout subsystem (not on the loop-16 acceptance
 * surface, which is `MeasuredNode` / `FolderBlock` / `PositionedNode`
 * / `LayoutComputation`).
 */

import type { VisNode } from '../types';

export interface FolderNode {
    path: string;
    name: string;
    depth: number;
    children: Map<string, FolderNode>;
    nodes: VisNode[];
    // Computed sizes
    contentWidth: number;
    contentHeight: number;
    width: number;
    height: number;
    // Final positions
    x: number;
    y: number;
}

export function makeEmptyFolder(path: string, name: string, depth: number): FolderNode {
    return {
        path, name, depth,
        children: new Map(),
        nodes: [],
        contentWidth: 0, contentHeight: 0,
        width: 0, height: 0,
        x: 0, y: 0,
    };
}

function normalizePath(p: string): string {
    return p.replace(/\\/g, '/');
}

export function getNodeFolderPath(node: VisNode): string {
    const path = normalizePath(node.fileId || node.id);
    const lastSlash = path.lastIndexOf('/');
    return lastSlash > 0 ? path.substring(0, lastSlash) : '';
}

export function ensureFolder(root: FolderNode, path: string): FolderNode {
    if (!path) return root;

    const parts = path.split('/').filter(p => p.length > 0);
    let current = root;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        if (!current.children.has(part)) {
            current.children.set(part, makeEmptyFolder(currentPath, part, i + 1));
        }
        current = current.children.get(part)!;
    }
    return current;
}

export function buildFolderTree(nodes: VisNode[]): FolderNode {
    const root = makeEmptyFolder('', 'root', 0);
    for (const node of nodes) {
        const folder = ensureFolder(root, getNodeFolderPath(node));
        folder.nodes.push(node);
    }
    return root;
}

export function findFolder(root: FolderNode, path: string): FolderNode | null {
    if (root.path === path) return root;
    for (const child of root.children.values()) {
        const found = findFolder(child, path);
        if (found) return found;
    }
    return null;
}

export function findParent(root: FolderNode, target: FolderNode): FolderNode | null {
    for (const child of root.children.values()) {
        if (child === target) return root;
        const found = findParent(child, target);
        if (found) return found;
    }
    return null;
}
