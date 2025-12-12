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

export interface ImportEdge extends Edge {
    kind: 'import';
    specifiers: Array<{ name: string; alias?: string }>; // What is imported
}

export type ImportGraph = Graph<FileNode, ImportEdge>;

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
    loc?: any;
};

export interface CallGraph extends Graph<EntityNode, CallEdge> {
    unresolved: UnresolvedCall[];
}

