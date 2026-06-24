/**
 * Browser-safe viewer payload contracts (Loop 08 / H1).
 *
 * Single source of truth for the DTOs injected into the webview as
 * `window.*` globals and consumed by the browser UI. This module must stay
 * browser-pure: it may import ONLY from other `src/contracts/*` and nothing
 * from node/fs/path/vscode/parser. The Node-side generator serializes these
 * shapes; the browser UI (and `src/webview/ui/types.ts` as a thin barrel)
 * re-exports them.
 */

import type { FolderTreeData } from './folder-tree';
import type { FolderEdgelistData } from './folder-edges';

export interface VisNode {
    id: string;
    label: string;
    group: string;
    /** Hover tooltip text (vis-network `title`). */
    title?: string;
    /** Node fill color, an `hsl(...)` string from the server ColorGenerator. */
    color?: string;
    fileId?: string; // For Call Graph
    /**
     * PC-04: call-graph capability baked onto call-graph nodes server-side.
     * 'heuristic' nodes (e.g. Python, name-matched) get a distinct badge +
     * tooltip in the renderer; 'semantic' (TS/JS) and absent render normally
     * (absence of badge = trusted). The browser never computes this itself.
     */
    callGraph?: 'semantic' | 'heuristic' | 'none';
}

export interface VisEdge {
    from: string;
    to: string;
    /** vis-network arrow spec (e.g. `'to'`); set on import/call edges. */
    arrows?: string;
    /**
     * Set to `true` when this edge sits inside a non-trivial SCC (a cycle),
     * computed server-side. For IMPORT edges: `computeInCycleEdgeKeys(importGraph)`
     * (Loop 02). For CALL edges: `computeCallInCycleEdgeKeys(callGraph)` (Loop 04)
     * — a call edge whose endpoints share a multi-node call SCC after
     * external-entity exclusion (size-1 self-recursion is NOT flagged here).
     * Omitted (undefined) for acyclic edges. The browser never computes cycle
     * membership itself; this drives the red stroke + `arrowhead-cycle` marker in
     * `EdgeRenderer` (which is graph-agnostic — it paints any in-cycle VisEdge).
     */
    inCycle?: boolean;
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
    /**
     * Loop 12: Whether this file's extension is parsable (computed server-side
     * from the parser registry). The browser must not import parser/config to
     * derive this — the Node-side worktree generator attaches the flag here.
     * Optional so older serialized worktrees still parse; consumers default
     * to `false` if missing.
     */
    isSupported?: boolean;
    /**
     * PH-04: statically a known source extension but its tree-sitter grammar
     * is not installed at runtime. The renderer shows a muted install hint
     * marker (not a live toggle) for these files.
     */
    needsGrammar?: boolean;
    /** PH-04: NPM grammar package to install to make this file parsable. */
    installHint?: string;
    /** PH-04: call-graph capability for this file's language (badge consumes it). */
    callGraph?: 'semantic' | 'heuristic' | 'none';
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

declare global {
    interface Window {
        GRAPH_DATA?: GraphData;
        WORK_TREE?: WorkTreeNode; // Root node
        DESIGN_DOCS?: { [key: string]: DesignDoc };  // Updated: Now includes markdown + HTML
        GRAPH_DATA_URL?: string; // Optional if loading via URL
        FOLDER_TREE?: FolderTreeData;     // loop 13 (emitted by loop 11)
        FOLDER_EDGES?: FolderEdgelistData; // loop 13 (emitted by loop 11)
        /** Loop 08: static-mode watched paths injected by the generator
         *  (`window.WATCHED_FILES = [...]`). Read by ui/main.ts. */
        WATCHED_FILES?: string[];
        /** Loop 14: when truthy, the webview logger emits .log/.debug.
         *  .warn/.error always emit regardless of this flag. */
        LLMEM_DEBUG?: boolean;
    }
}
