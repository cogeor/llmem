export interface Node {
    id: string;      // Unique identifier
    label: string;   // Human-readable label (e.g., filename, function name)
}

export interface Edge {
    source: string;  // Source Node ID
    target: string;  // Target Node ID
}

export interface Graph<N extends Node, E extends Edge> {
    nodes: Map<string, N>;
    edges: E[];
}

// Import Graph Types
export interface FileNode extends Node {
    kind: 'file';
    path: string;    // Repo-relative path (e.g., "src/parser/parser.ts")
    language: string;
}

/**
 * External module node — a bare module specifier imported from a workspace
 * file but not itself a workspace file (e.g., 'react', 'pathlib', 'os').
 *
 * Loop 16: this is a runtime-model type. The persisted `NodeEntry.kind`
 * enum stays homogenous (file or entity); the workspace-vs-external
 * distinction is recovered at view time via `parseGraphId` /
 * `isExternalModuleId`. See `graph/edgelist-schema.ts` for the persisted
 * shape.
 */
export interface ExternalModuleNode extends Node {
    kind: 'external';
    module: string;  // bare specifier, e.g. 'react', 'pathlib'
}

export interface ImportEdge extends Edge {
    kind: 'import';
    specifiers: Array<{ name: string; alias?: string }>; // What is imported
}

export type ImportGraphNode = FileNode | ExternalModuleNode;
export type ImportGraph = Graph<ImportGraphNode, ImportEdge>;

// Call Graph Types
export interface EntityNode extends Node {
    kind: 'function' | 'method' | 'class' | 'constructor';
    fileId: string;  // Reference to the FileNode ID
    parentEntityId?: string; // For methods inside classes
    signature?: string;
}

export interface CallEdge extends Edge {
    kind: 'call';
    callSiteId: string; // ID from the artifact CallSite
}

export type UnresolvedCall = {
    from: string;
    callSiteId: string;
    calleeName: string;
    kind: string;
    loc?: { line: number; column: number };
};

export interface CallGraph extends Graph<EntityNode, CallEdge> {
    unresolved: UnresolvedCall[];
}

