import * as path from 'path';
import { FileArtifact } from '../../parser/types';
import { ArtifactBundle } from '../artifact/reader';
import { FileNode, ImportEdge, ImportGraph } from '../types';
import { normalizePath } from '../utils';

export function buildImportGraph(artifacts: ArtifactBundle[]): ImportGraph {
    const nodes = new Map<string, FileNode>();
    const edges: ImportEdge[] = [];

    // Pass 1: Create nodes
    for (const { fileId, artifact } of artifacts) {
        // Only valid artifacts become nodes
        nodes.set(fileId, {
            id: fileId,
            kind: 'file',
            label: fileId,
            path: fileId,
            language: artifact.file?.language || 'unknown'
        });
    }

    // Helper: Resolve import source to a FileID
    function resolveImport(currentFileId: string, importSource: string): string | null {
        // 1. Handle relative imports
        if (importSource.startsWith('.')) {
            const currentDir = path.dirname(currentFileId);
            const candidateBase = path.join(currentDir, importSource);
            // path.join uses OS separator, we need normalized for IDs
            const normalizedBase = normalizePath(candidateBase);

            // Try extensions
            const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];
            for (const ext of extensions) {
                const probe = normalizedBase + ext;
                if (nodes.has(probe)) return probe;
            }
        }

        // 2. Handle absolute imports (if project uses src alias or similar?) 
        // For now, assume simple relative resolution is the primary need.
        // If not relative, check if it matches a file ID directly (unlikely for node_modules)
        if (nodes.has(importSource)) return importSource;

        return null;
    }

    // Pass 2: Create edges
    for (const { fileId, artifact } of artifacts) {
        if (!artifact.imports) continue;

        for (const imp of artifact.imports) {
            // Try to resolve
            // Use existing resolvedPath if available (and valid), else try our resolver
            let targetFileId: string | null = null;

            if (imp.resolvedPath) {
                targetFileId = normalizePath(imp.resolvedPath);
                if (!nodes.has(targetFileId!)) targetFileId = null;
            }

            if (!targetFileId) {
                targetFileId = resolveImport(fileId, imp.source);
            }

            if (targetFileId) {
                const edge: ImportEdge = {
                    source: fileId,
                    target: targetFileId,
                    kind: 'import',
                    specifiers: imp.specifiers.map(s => ({ name: s.name, alias: s.alias }))
                };
                edges.push(edge);
            }
        }
    }

    return { nodes, edges };
}
