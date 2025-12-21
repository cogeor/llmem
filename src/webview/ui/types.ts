
export interface VisNode {
    id: string;
    label: string;
    group: string;
    fileId?: string; // For Call Graph
    [key: string]: any;
}

export interface VisEdge {
    from: string;
    to: string;
    [key: string]: any;
}

export interface GraphData {
    importGraph: {
        nodes: VisNode[];
        edges: VisEdge[];
    };
    callGraph: {
        nodes: VisNode[];
        edges: VisEdge[];
    };
}

/**
 * Graph computation status for a folder/file.
 * - 'never': edges have never been computed
 * - 'outdated': edges exist but files have changed since computation
 * - 'current': edges are up-to-date with source files
 */
export type GraphStatus = 'never' | 'outdated' | 'current';

export interface FileNode {
    name: string;
    type: 'file';
    path: string; // Relative path
    lineCount: number;
    importStatus?: GraphStatus;  // Status of import edges for this file
    callStatus?: GraphStatus;    // Status of call edges for this file
}

export interface DirectoryNode {
    name: string;
    type: 'directory';
    path: string;
    children: (FileNode | DirectoryNode)[];
    importStatus?: GraphStatus;  // Status of import edges for this folder
    callStatus?: GraphStatus;    // Status of call edges for this folder
}

export type WorkTreeNode = FileNode | DirectoryNode;

export interface AppState {
    currentView: "design" | "graph";
    graphType: "import" | "call";
    selectedPath: string | null;
    selectedType: "file" | "directory" | null;
    expandedFolders: Set<string>;
    watchedPaths: Set<string>;  // Paths with active file watching
}

declare global {
    interface Window {
        GRAPH_DATA?: GraphData;
        WORK_TREE?: WorkTreeNode; // Root node
        DESIGN_DOCS?: { [key: string]: string };
        GRAPH_DATA_URL?: string; // Optional if loading via URL
    }
}
