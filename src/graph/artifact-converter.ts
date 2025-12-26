/**
 * Converts FileArtifact (from extractors) to EdgeList entries.
 * 
 * This bridges the parsing layer to the edge list storage.
 */

import { FileArtifact, Entity, ImportSpec, CallSite } from '../parser/types';
import { NodeEntry, EdgeEntry } from './edgelist';
import { normalizePath } from './utils';
import { ALL_SUPPORTED_EXTENSIONS } from '../parser/config';

export interface ConversionResult {
    nodes: NodeEntry[];
    importEdges: EdgeEntry[];  // kind: 'import' - file-to-file
    callEdges: EdgeEntry[];    // kind: 'call' - entity-to-entity
}

/**
 * Convert a FileArtifact to edge list entries.
 * 
 * @param artifact The parsed file artifact from an extractor
 * @param fileId The normalized file ID (relative path)
 * @returns Nodes and edges for the edge list
 */
export function artifactToEdgeList(artifact: FileArtifact, fileId: string): ConversionResult {
    const nodes: NodeEntry[] = [];
    const importEdges: EdgeEntry[] = [];
    const callEdges: EdgeEntry[] = [];
    const externalModules = new Set<string>();

    // 0. Always create a file node (ensures import edges work for files with only types/interfaces)
    nodes.push({
        id: fileId,
        name: fileId.split('/').pop() || fileId,
        kind: 'file',
        fileId
    });

    // 1. Create entity nodes
    for (const entity of artifact.entities) {
        const nodeId = `${fileId}::${entity.name}`;

        // Map entity kind to node kind
        let kind: NodeEntry['kind'] = 'function';
        if (entity.kind === 'class') kind = 'class';
        else if (entity.kind === 'method') kind = 'method';
        else if (entity.kind === 'arrow') kind = 'arrow';
        else if (entity.kind === 'const') kind = 'const';

        nodes.push({
            id: nodeId,
            name: entity.name,
            kind,
            fileId
        });

        // 2. Create call edges from this entity
        if (entity.calls) {
            for (const call of entity.calls) {
                const callEdge = resolveCallToEdge(fileId, nodeId, call, artifact.imports, externalModules);
                if (callEdge) {
                    callEdges.push(callEdge);
                }
            }
        }
    }

    // 3. Create import edges
    for (const imp of artifact.imports) {
        const targetFileId = resolveImportTarget(fileId, imp);

        if (targetFileId) {
            // Check if this is an external module (no file extension)
            const isExternal = !ALL_SUPPORTED_EXTENSIONS.some(ext => targetFileId.endsWith(ext))
                && !targetFileId.includes('/');

            if (isExternal) {
                // External module import (e.g., pathlib, os, json)
                externalModules.add(targetFileId);

                // Create module node if not exists
                const moduleNodeExists = nodes.some(n => n.id === targetFileId);
                if (!moduleNodeExists) {
                    nodes.push({
                        id: targetFileId,
                        name: targetFileId,
                        kind: 'file', // External modules shown as file nodes
                        fileId: targetFileId
                    });
                }

                // Create import edge to module
                importEdges.push({
                    source: fileId,
                    target: targetFileId,
                    kind: 'import'
                });

                // Create nodes for imported classes/functions from external modules
                for (const spec of imp.specifiers) {
                    if (spec.name !== '*') {
                        const entityNodeId = `${targetFileId}::${spec.name}`;
                        const entityNodeExists = nodes.some(n => n.id === entityNodeId);

                        if (!entityNodeExists) {
                            nodes.push({
                                id: entityNodeId,
                                name: spec.name,
                                kind: 'function', // Could be class, function, etc.
                                fileId: targetFileId
                            });
                        }
                    }
                }
            } else if (!targetFileId.includes('node_modules')) {
                // Internal import (workspace file)
                importEdges.push({
                    source: fileId,
                    target: targetFileId,
                    kind: 'import'
                });
            }
        }
    }

    return { nodes, importEdges, callEdges };
}

/**
 * Resolve an import to a target file ID.
 * Returns either a file path (for workspace files) or module name (for external modules).
 */
function resolveImportTarget(sourceFileId: string, imp: ImportSpec): string | null {
    // If the import has a resolved path (from extractor), use it
    if (imp.resolvedPath) {
        return normalizePath(imp.resolvedPath);
    }

    // Try to resolve relative imports
    if (imp.source.startsWith('.')) {
        const path = require('path');
        const sourceDir = path.dirname(sourceFileId);

        // Count leading dots to determine directory level
        // .a → current dir, ..a → parent, ...a → grandparent
        const dotMatch = imp.source.match(/^\.+/);
        const dotCount = dotMatch ? dotMatch[0].length : 1;

        // Remove leading dots to get module name
        const modulePart = imp.source.replace(/^\.+/, '');

        // Navigate up directories (1 dot = current dir, 2 dots = parent, etc.)
        const dotsUp = dotCount - 1;
        let targetDir = sourceDir;
        for (let i = 0; i < dotsUp; i++) {
            targetDir = path.dirname(targetDir);
        }

        // Join with module part (convert dots to path separators)
        let resolved: string;
        if (modulePart) {
            // from .a import b → ./a.py
            // from ..foo.bar import b → ../foo/bar.py
            const modulePath = modulePart.split('.').join('/');
            resolved = path.join(targetDir, modulePath);
        } else {
            // from . import b → ./__init__.py
            resolved = targetDir;
        }
        resolved = normalizePath(resolved);

        // Infer extension from source file (e.g., .py file imports .py, .ts imports .ts)
        const sourceExt = path.extname(sourceFileId);
        const defaultExt = sourceExt || '.ts';

        // Try with same extension as source file first, then common extensions
        const extensions = [defaultExt, ...ALL_SUPPORTED_EXTENSIONS.filter(e => e !== defaultExt)];
        for (const ext of extensions) {
            const candidate = resolved + ext;
            // We can't check if file exists here (no FS access in pure conversion)
            // Return first candidate with matching extension
            return candidate;
        }
        return resolved + defaultExt;
    }

    // External/node_modules imports - return module name as-is
    // This allows us to create module nodes and track dependencies
    // Filter out node_modules paths (keep only package names)
    if (!imp.source.includes('node_modules')) {
        // Check if this looks like a workspace import with dot notation (e.g., src.db.models.ticker)
        // Multi-part names (2+ segments) suggest workspace structure, not external packages
        const parts = imp.source.split('.');

        if (parts.length >= 2 && !imp.source.startsWith('.')) {
            // Convert dot notation to file path for workspace imports
            // e.g., src.db.models.ticker → src/db/models/ticker.py
            const path = require('path');
            const sourceExt = path.extname(sourceFileId);
            const defaultExt = sourceExt || '.ts';
            const filePath = parts.join('/') + defaultExt;
            return filePath;
        }

        return imp.source; // Return module name (e.g., 'pathlib', 'os', 'json')
    }

    return null;
}

/**
 * Resolve a call site to an edge.
 */
function resolveCallToEdge(
    fileId: string,
    callerNodeId: string,
    call: CallSite,
    imports: ImportSpec[],
    externalModules: Set<string>
): EdgeEntry | null {
    // If the call has a resolved definition, use it
    if (call.resolvedDefinition) {
        let targetFileId = call.resolvedDefinition.file;

        // Check if this is a builtin (skip creating edges for builtins)
        if (targetFileId === '<builtin>') {
            return null;
        }

        // Don't normalize module names (they don't have paths)
        const isExternal = !ALL_SUPPORTED_EXTENSIONS.some(ext => targetFileId.endsWith(ext))
            && !targetFileId.includes('/');

        if (!isExternal) {
            targetFileId = normalizePath(targetFileId);
        }

        const targetNodeId = `${targetFileId}::${call.resolvedDefinition.name}`;
        return {
            source: callerNodeId,
            target: targetNodeId,
            kind: 'call'
        };
    }

    // Try to resolve based on imports
    const calleeName = call.calleeName.split('.')[0]; // Base name (e.g., "Parser" from "Parser.parse")

    for (const imp of imports) {
        const targetFileId = resolveImportTarget(fileId, imp);
        if (!targetFileId) continue;

        // Check if this import brings in the callee
        for (const spec of imp.specifiers) {
            const localName = spec.alias || spec.name;
            if (localName === calleeName) {
                // Found it - the call is to something from this import
                const targetNodeId = `${targetFileId}::${spec.name}`;
                return {
                    source: callerNodeId,
                    target: targetNodeId,
                    kind: 'call'
                };
            }
        }
    }

    // Local call within same file?
    const targetNodeId = `${fileId}::${calleeName}`;
    return {
        source: callerNodeId,
        target: targetNodeId,
        kind: 'call'
    };
}

/**
 * Convert multiple artifacts to edge list entries.
 * Useful for batch processing.
 */
export function artifactsToEdgeList(artifacts: Array<{ fileId: string; artifact: FileArtifact }>): ConversionResult {
    const allNodes: NodeEntry[] = [];
    const allImportEdges: EdgeEntry[] = [];
    const allCallEdges: EdgeEntry[] = [];

    for (const { fileId, artifact } of artifacts) {
        const { nodes, importEdges, callEdges } = artifactToEdgeList(artifact, fileId);
        allNodes.push(...nodes);
        allImportEdges.push(...importEdges);
        allCallEdges.push(...callEdges);
    }

    return { nodes: allNodes, importEdges: allImportEdges, callEdges: allCallEdges };
}
