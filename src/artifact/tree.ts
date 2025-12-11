import * as path from 'path';
import { ArtifactMetadata, ArtifactTree, ArtifactTreeNode } from './types';

export class ArtifactTreeManager {
    private tree: ArtifactTree = { path: '', isDirectory: true, children: [] };

    constructor() { }

    build(records: ArtifactMetadata[]): void {
        // Reset tree
        this.tree = { path: '', isDirectory: true, children: [] };

        for (const record of records) {
            this.insert(record);
        }
    }

    getTree(): ArtifactTree {
        return this.tree;
    }

    private insert(record: ArtifactMetadata): void {
        // We want to build a tree based on the SOURCE path, not the artifact path.
        // User wants to see artifacts attached to their source files.
        // Source path: src/foo/bar.ts
        // Tree: src -> foo -> bar.ts (file node) -> has artifacts

        const parts = record.sourcePath.split(/[/\\]/); // Split by separator
        let currentNode = this.tree;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isLast = i === parts.length - 1;

            // Assume empty parts (e.g. leading slash) are skipped or handled
            if (!part) continue;

            if (!currentNode.children) {
                currentNode.children = [];
            }

            let child = currentNode.children.find(c => path.basename(c.path) === part);

            if (!child) {
                // Construct path for this node. 
                // Note: simplified logic, might need fuller path reconstruction in a real app
                // depending on what 'path' property implies (full path or name).
                // Let's assume 'path' in TreeNode is the full relative path from root.
                const childPath = currentNode.path ? path.join(currentNode.path, part) : part;

                child = {
                    path: childPath,
                    // If it's the last part of sourcePath, it's a file (usually).
                    // Unless the source IS a directory? 
                    // Artifacts are usually attached to files.
                    isDirectory: !isLast,
                    children: [],
                    artifacts: []
                };
                currentNode.children.push(child);
            }

            if (isLast) {
                // It's the file node. Add artifact.
                if (!child.artifacts) child.artifacts = [];
                child.artifacts.push(record);
            }

            currentNode = child;
        }
    }
}
