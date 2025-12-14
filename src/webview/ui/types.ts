
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

export interface FileNode {
    name: string;
    type: 'file';
    path: string; // Relative path
    lineCount: number;
}

export interface DirectoryNode {
    name: string;
    type: 'directory';
    path: string;
    children: (FileNode | DirectoryNode)[];
}

export type WorkTreeNode = FileNode | DirectoryNode;

export interface AppState {
    currentView: "design" | "graph";
    graphType: "import" | "call";
    selectedPath: string | null;
    selectedType: "file" | "directory" | null;
    expandedFolders: Set<string>;
}

declare global {
    interface Window {
        GRAPH_DATA?: GraphData;
        WORK_TREE?: WorkTreeNode; // Root node
        DESIGN_DOCS?: { [key: string]: string };
        GRAPH_DATA_URL?: string; // Optional if loading via URL
    }
}
