/**
 * Graph identifier contract. The single owner of graph-ID construction
 * and parsing across LLMem.
 *
 * Format
 * ------
 * Entity IDs are `<fileId>::<entityName>`. parseGraphId splits on the
 * FIRST `::` it sees. Entity names containing `::` are not supported as
 * a contract; current behavior is documented in
 * tests/arch/graph-ids.test.ts ("entity name containing '::'").
 *
 * The `#` character is NOT a recognized graph-ID separator. Earlier code
 * in src/webview/ui/components/GraphView.ts and src/graph/edgelist.ts
 * used `#` defensively; that was dead code (no node ID has ever
 * contained `#`) and is removed in Loop 03.
 *
 * Persisted format
 * ----------------
 * The on-disk JSON edge-list format stores `id: string`. This module's
 * branded types are compile-time only — runtime values remain plain
 * strings, byte-for-byte identical to what artifact-converter previously
 * produced. Loop 03 is a pure code-organization refactor.
 *
 * Allowed callers
 * ---------------
 * Any module under src/ may import from src/core/ids.ts. The locality
 * scan in tests/arch/graph-ids.test.ts allows `'::'` and `'#'` literals
 * only inside this file; other files allowlist literals via
 * LITERAL_USE_ALLOWLIST.
 */

// Branded types (purely compile-time; runtime values are plain strings to
// preserve the on-disk JSON format byte-for-byte).
export type FileId = string & { readonly __brand: 'FileId' };
export type EntityId = string & { readonly __brand: 'EntityId' };
export type ExternalModuleId = string & { readonly __brand: 'ExternalModuleId' };
export type GraphId = FileId | EntityId | ExternalModuleId;

export type ParsedGraphId =
    | { kind: 'file'; fileId: FileId }
    | { kind: 'entity'; fileId: FileId; name: string }
    | { kind: 'external'; module: ExternalModuleId };

// Constants — exported so callers can refer to the canonical separator
// without re-typing the literal.
export const ENTITY_SEPARATOR = '::' as const;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function makeFileId(rel: string): FileId {
    return rel as FileId;
}

export function makeEntityId(fileId: FileId | string, name: string): EntityId {
    return `${fileId}${ENTITY_SEPARATOR}${name}` as EntityId;
}

export function makeExternalModuleId(specifier: string): ExternalModuleId {
    return specifier as ExternalModuleId;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function isExternalModuleId(id: string): boolean {
    // Loop 16: dropped a redundant `!id.startsWith('src/')` clause —
    // `!id.includes('/')` is the operative check (workspace file IDs are
    // repo-relative paths and always contain a slash; external module
    // specifiers like 'react' or 'pathlib' do not).
    return !id.includes(ENTITY_SEPARATOR) && !id.includes('/');
}

export function parseGraphId(id: string): ParsedGraphId {
    const idx = id.indexOf(ENTITY_SEPARATOR);
    if (idx >= 0) {
        return {
            kind: 'entity',
            fileId: id.slice(0, idx) as FileId,
            name: id.slice(idx + ENTITY_SEPARATOR.length),
        };
    }
    if (isExternalModuleId(id)) {
        return { kind: 'external', module: id as ExternalModuleId };
    }
    return { kind: 'file', fileId: id as FileId };
}

// ---------------------------------------------------------------------------
// Convenience predicates
// ---------------------------------------------------------------------------

export function isEntityOfFile(id: string, fileId: FileId | string): boolean {
    return id.startsWith(`${fileId}${ENTITY_SEPARATOR}`);
}
