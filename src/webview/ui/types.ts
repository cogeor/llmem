
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

/**
 * Design view mode: view (rendered HTML) or edit (markdown source)
 */
export type DesignViewMode = 'view' | 'edit';

/**
 * Design document with both markdown source and rendered HTML
 */
export interface DesignDoc {
    markdown: string;
    html: string;
}

export interface AppState {
    currentView: "design" | "graph";
    graphType: "import" | "call";
    selectedPath: string | null;
    selectedType: "file" | "directory" | null;
    selectionSource?: "explorer" | "graph";  // Track where selection came from
    expandedFolders: Set<string>;
    watchedPaths: Set<string>;  // Paths with active file watching
    designViewMode: DesignViewMode;  // View or edit mode for design docs
    /**
     * Whether call graph data is available.
     * Determined by backend based on graph data (not languages).
     * UI should hide call graph button if false.
     */
    callGraphAvailable: boolean;
}

declare global {
    interface Window {
        GRAPH_DATA?: GraphData;
        WORK_TREE?: WorkTreeNode; // Root node
        DESIGN_DOCS?: { [key: string]: DesignDoc };  // Updated: Now includes markdown + HTML
        GRAPH_DATA_URL?: string; // Optional if loading via URL
    }
}
