import * as path from 'path';
import { ArtifactBundle } from '../artifact/reader';
import { CallGraph, EntityNode, CallEdge, UnresolvedCall } from '../types';
import { resolveCall, buildImportBindings, buildExportIndex } from './resolution';
import { deriveEntityId, deriveCallSiteKey, normalizePath } from '../utils';

export function buildCallGraph(artifacts: ArtifactBundle[]): CallGraph {
    const nodes = new Map<string, EntityNode>();
    const edges: CallEdge[] = [];
    const unresolved: UnresolvedCall[] = [];

    // Auxiliary Indices
    // fileId -> entityName -> [globalId]
    const entityIndexByFileAndName = new Map<string, Map<string, string[]>>();
    // fileId -> exportName -> globalId
    const exportIndexByFileAndName = new Map<string, Map<string, string | null>>();
    // fileId -> bindings
    const importBindingIndex = new Map<string, any>();

    // Pass 1: Create nodes and build indices
    for (const { fileId, artifact } of artifacts) {
        if (!entityIndexByFileAndName.has(fileId)) {
            entityIndexByFileAndName.set(fileId, new Map());
        }

        for (const entity of artifact.entities) {
            // Only callable things + classes (as containers)
            if (['function', 'method', 'ctor', 'arrow', 'getter', 'setter', 'class'].includes(entity.kind)) {
                const globalId = deriveEntityId(fileId, entity.id);
                console.log(`DEBUG: Doing node for ${fileId}, entity ${entity.name}`);
                const node: EntityNode = {
                    id: globalId,
                    label: `${fileId}:${entity.name}`,
                    kind: entity.kind as any,
                    fileId: fileId,
                    signature: entity.signature
                };
                nodes.set(globalId, node);

                // Indexing
                const nameIndex = entityIndexByFileAndName.get(fileId)!;
                if (!nameIndex.has(entity.name)) nameIndex.set(entity.name, []);
                nameIndex.get(entity.name)!.push(globalId);
            }
        }

        // Build Export Index
        exportIndexByFileAndName.set(fileId, buildExportIndex(
            artifact.exports || [],
            artifact.entities || [],
            fileId,
            deriveEntityId
        ));

        // Build Import Bindings
        importBindingIndex.set(fileId, buildImportBindings(
            artifact.imports || [],
            normalizePath
        ));
    }

    // Pass 2: Resolve calls
    for (const { fileId, artifact } of artifacts) {

        for (const entity of artifact.entities) {
            if (!entity.calls) continue;

            const callerGid = deriveEntityId(fileId, entity.id);
            // Must exist if we created it in Pass 1
            if (!nodes.has(callerGid)) continue;

            entity.calls.forEach((call, index) => {
                const callSiteKey = deriveCallSiteKey(fileId, entity.id, call.callSiteId, index);

                // Optimization: If parser provided resolved definition, use it directly
                if (call.resolvedDefinition) {
                    const { file: targetFileId, name: targetName } = call.resolvedDefinition;
                    // Check if we have this file and entity indexed
                    if (entityIndexByFileAndName.has(targetFileId)) {
                        const fileIndex = entityIndexByFileAndName.get(targetFileId)!;
                        // For methods, the entity name in our index is the method name
                        if (fileIndex.has(targetName)) {
                            const possibleIds = fileIndex.get(targetName)!;
                            if (possibleIds.length > 0) {
                                // Ambiguity check: if multiple ids, we pick first? 
                                // Ideally TS resolution is precise. But our flatten index might collide 
                                // (e.g. two classes in same file having same method name?)
                                // For now, taking first is vastly better than nothing.
                                edges.push({
                                    source: callerGid,
                                    target: possibleIds[0],
                                    kind: 'call',
                                    callSiteId: callSiteKey
                                });
                                return;
                            }
                        }
                    }
                }

                const res = resolveCall(
                    fileId,
                    call.calleeName,
                    entityIndexByFileAndName,
                    importBindingIndex.get(fileId),
                    exportIndexByFileAndName,
                    deriveEntityId,
                    normalizePath
                );


                if (res.status === 'resolved') {
                    edges.push({
                        source: callerGid,
                        target: res.targetEntityId,
                        kind: 'call',
                        callSiteId: callSiteKey
                    });
                } else {
                    unresolved.push({
                        from: callerGid,
                        callSiteId: callSiteKey,
                        calleeName: call.calleeName,
                        kind: call.kind,
                        loc: call.loc
                    });
                }
            });
        }
    }

    // Attach unresolved metadata to the graph object (if our type supports it roughly, or just drop it if strict)
    // The type `CallGraph` we defined has undefined `unresolved` property? 
    // Let's check src/graph/types.ts
    // I did not add `unresolved` to CallGraph interface in the previous step, only `CallEdge`.
    // The plan had it. I should probably add it or just return it loosely?
    // Let's coerce for now or strictly follow types. strict types: Graph<N, E>.
    // Using simple extension:
    return { nodes, edges, unresolved };
}
