
// Loop 08 (H1): the injected viewer payload DTOs now live in the single
// browser-safe contracts module. This file is a thin barrel that re-exports
// them so every existing `../ui/types` / `./types` importer keeps compiling
// unchanged. App-internal UI state (`AppState`) stays defined locally below.
//
// The bare `import` (not just the type-only re-export) pulls in the
// `declare global { interface Window { ... } }` augmentation from the
// contracts module, so consumers that read `window.GRAPH_DATA` etc. keep
// their typing.
import '../../contracts/webview-payloads';

export type {
    VisNode,
    VisEdge,
    GraphData,
    GraphStatus,
    FileNode,
    DirectoryNode,
    WorkTreeNode,
    DesignViewMode,
    DesignDoc,
} from '../../contracts/webview-payloads';

import type { DesignViewMode } from '../../contracts/webview-payloads';

export interface AppState {
    currentView: "graph" | "design" | "packages" | "folders";
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
    /**
     * Loop 08 (health-highlight): when true, clone edges render amber-dashed
     * and smelly nodes get a badge + detail-panel smell list. Defaults false.
     */
    healthHighlight: boolean;
}
