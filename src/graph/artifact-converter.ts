/**
 * Converts FileArtifact (from extractors) to EdgeList entries.
 * 
 * This bridges the parsing layer to the edge list storage.
 */

import { FileArtifact, Entity, ImportSpec, CallSite } from '../parser/types';
import { NodeEntry, EdgeEntry } from './edgelist';
import { normalizePath } from './utils';
import { TYPESCRIPT_EXTENSIONS } from '../parser/config';

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
                const callEdge = resolveCallToEdge(fileId, nodeId, call, artifact.imports);
                if (callEdge) {
                    callEdges.push(callEdge);
                }
            }
        }
    }

    // 3. Create import edges (skip external/node_modules imports)
    for (const imp of artifact.imports) {
        const targetFileId = resolveImportTarget(fileId, imp);
        if (targetFileId && !targetFileId.includes('node_modules')) {
            importEdges.push({
                source: fileId,
                target: targetFileId,
                kind: 'import'
            });
        }
    }

    return { nodes, importEdges, callEdges };
}

/**
 * Resolve an import to a target file ID.
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
        let resolved = path.join(sourceDir, imp.source);
        resolved = normalizePath(resolved);

        // Try common extensions (should match common source extensions)
        const extensions = ['', ...TYPESCRIPT_EXTENSIONS, '.dart', '.rs'];
        for (const ext of extensions) {
            const candidate = resolved + ext;
            // We can't check if file exists here (no FS access in pure conversion)
            // Just return the most likely path
            if (ext) return candidate;
        }
        return resolved + '.ts'; // Default assumption
    }

    // External/node_modules imports - skip for now
    return null;
}

/**
 * Resolve a call site to an edge.
 */
function resolveCallToEdge(
    fileId: string,
    callerNodeId: string,
    call: CallSite,
    imports: ImportSpec[]
): EdgeEntry | null {
    // If the call has a resolved definition, use it
    if (call.resolvedDefinition) {
        const targetFileId = normalizePath(call.resolvedDefinition.file);
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
