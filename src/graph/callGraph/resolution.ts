import { Entity, ImportSpec, ExportSpec } from '../../parser/types';
import { EntityNode, ImportGraph } from '../types';

export type ResolutionResult =
    | { status: 'resolved'; targetEntityId: string }
    | { status: 'ambiguous'; reason: string }
    | { status: 'unresolved'; reason: string };

export type ImportBindings = {
    named: Map<string, { targetFileId: string, exportedName: string }>;
    namespace: Map<string, string>; // alias -> targetFileId
    default: Map<string, string>;   // localName -> targetFileId
};

export function buildImportBindings(imports: ImportSpec[], normalizeId: (p: string) => string): ImportBindings {
    const bindings: ImportBindings = {
        named: new Map(),
        namespace: new Map(),
        default: new Map()
    };

    for (const imp of imports) {
        if (!imp.resolvedPath) continue;
        const targetFileId = normalizeId(imp.resolvedPath);

        for (const spec of imp.specifiers) {
            if (spec.name === '*') {
                if (spec.alias) bindings.namespace.set(spec.alias, targetFileId);
            } else if (spec.name === 'default') {
                const local = spec.alias || spec.name;
                bindings.default.set(local, targetFileId);
            } else {
                // Named import
                const local = spec.alias || spec.name;
                bindings.named.set(local, { targetFileId, exportedName: spec.name });
            }
        }
    }
    return bindings;
}

export function buildExportIndex(exports: ExportSpec[], entities: Entity[], fileId: string, deriveId: (fid: string, eid: string) => string): Map<string, string | null> {
    const index = new Map<string, string | null>();
    const entityByName = new Map<string, Entity[]>();

    for (const ent of entities) {
        if (!entityByName.has(ent.name)) entityByName.set(ent.name, []);
        entityByName.get(ent.name)!.push(ent);
    }

    for (const ex of exports) {
        const exportedName = ex.name;
        // If it's a re-export without local binding, we can't link to an entity in THIS file easily (unless we follow re-exports, which is Tier D+)
        // For now, map to local entity if name matches

        // Use localName if available, otherwise name
        const localName = ex.localName || ex.name;
        const candidates = entityByName.get(localName);

        if (candidates && candidates.length === 1) {
            index.set(exportedName, deriveId(fileId, candidates[0].id));
        } else {
            // Ambiguous or not found locally (e.g. re-export from another module)
            index.set(exportedName, null);
        }
    }

    return index;
}

export function resolveCall(
    fileId: string,
    calleeName: string,
    entityIndex: Map<string, Map<string, string[]>>, // fileId -> entityName -> list[globalId]
    importBindings: ImportBindings,
    exportIndex: Map<string, Map<string, string | null>>, // fileId -> exportName -> globalId?
    deriveId: (fid: string, eid: string) => string,
    normalizeId: (path: string) => string
): ResolutionResult {

    // Clean callee
    const base = calleeName.replace(/\(.*\)$/, ''); // remove "()" if present
    const parts = base.split('.');

    // Tier A: this.method
    if (parts[0] === 'this' && parts.length >= 2) {
        const member = parts[1];
        const candidates = entityIndex.get(fileId)?.get(member);
        if (candidates) {
            if (candidates.length === 1) return { status: 'resolved', targetEntityId: candidates[0] };
            if (candidates.length > 1) return { status: 'ambiguous', reason: 'Multiple local members match' };
        }
    }

    // Tier B: Bare identifier
    if (parts.length === 1) {
        const name = parts[0];

        // 1. Try local definitions
        const localCandidates = entityIndex.get(fileId)?.get(name);
        if (localCandidates) {
            if (localCandidates.length === 1) return { status: 'resolved', targetEntityId: localCandidates[0] };
            // If explicit local definition exists, it shadows imports
            if (localCandidates.length > 1) return { status: 'ambiguous', reason: 'Multiple local entities match' };
        }

        // 2. Try imports
        // Named import
        if (importBindings.named.has(name)) {
            const { targetFileId, exportedName } = importBindings.named.get(name)!;
            const targetGid = exportIndex.get(targetFileId)?.get(exportedName);
            if (targetGid) return { status: 'resolved', targetEntityId: targetGid };
            return { status: 'unresolved', reason: 'Imported entity not found in export index' };
        }
        // Default import - difficult without knowing what the default export IS (class? func?). 
        // We'd need to look up "default" in exportIndex.
        if (importBindings.default.has(name)) {
            const targetFileId = importBindings.default.get(name)!;
            // convention: export definition for 'default'
            const targetGid = exportIndex.get(targetFileId)?.get('default');
            if (targetGid) return { status: 'resolved', targetEntityId: targetGid };
        }
    }

    // Tier D: Namespace import (e.g. fs.readFile)
    if (parts.length >= 2) {
        const ns = parts[0];
        const member = parts[1];
        if (importBindings.namespace.has(ns)) {
            const targetFileId = importBindings.namespace.get(ns)!;
            const targetGid = exportIndex.get(targetFileId)?.get(member);
            if (targetGid) return { status: 'resolved', targetEntityId: targetGid };
            return { status: 'unresolved', reason: `Member ${member} not found in exported namespace` };
        }
    }

    // Support simple class instantiation: new Parser() -> Parser
    if (base.startsWith('new ')) {
        const className = base.substring(4).trim();
        return resolveCall(fileId, className, entityIndex, importBindings, exportIndex, deriveId, normalizeId);
    }

    return { status: 'unresolved', reason: 'Not found locally or in imports' };
}
