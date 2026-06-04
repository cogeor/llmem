/**
 * Package view-model — vis-network type surface + tree→vis transforms
 * (Loop 15 split).
 *
 * Carved verbatim from the former `folderViewModel.ts` monolith: the minimal
 * vis-network type declarations (shared by FolderArcNetwork at runtime) and
 * the pure `buildVisNodes` / `buildVisEdges` transforms.
 *
 * Browser-pure: function-only + interface exports, no `window.*`,
 * `document.*`, `node:*`, or `vscode` imports. Re-exported through the
 * `folderViewModel.ts` barrel.
 */

import type { FolderNode } from '../../../../contracts/folder-tree';
import type { FolderEdgelistData, FolderEdge } from '../../../../contracts/folder-edges';

// ---------------------------------------------------------------------------
// vis-network type surface (used by FolderArcNetwork.ts at runtime).
//
// The minimal types PackageView/FolderArcNetwork construct + read.
// Adding `@types/vis-network` would inflate the type surface without
// adding runtime safety; the surface lives here so multiple consumers
// (the network component + this view-model) share a single declaration.
// ---------------------------------------------------------------------------

export interface VisNetworkNode {
    id: string;
    label: string;
    shape?: 'box' | 'circle' | 'ellipse';
    /** vis-network supports HTML labels via `font.multi: 'html'`. */
    title?: string;
}

export interface VisNetworkEdge {
    /** Stable per-edge id so events can identify which edge fired. */
    id: string;
    from: string;
    to: string;
    /** vis-network expects a string color or { color, opacity }. */
    color?: string | { color?: string; opacity?: number };
    width?: number;
    label?: string;
    title?: string;
    /** Round-trip of the underlying FolderEdge for click-handler use. */
    __folderEdge?: FolderEdge;
}

export interface VisNetworkOptions {
    physics?: boolean | { enabled: boolean };
    interaction?: {
        hover?: boolean;
        selectConnectedEdges?: boolean;
        dragNodes?: boolean;
        dragView?: boolean;
        zoomView?: boolean;
    };
    edges?: { smooth?: boolean | { type: string }; arrows?: { to?: { enabled: boolean } } };
    nodes?: { shape?: string; font?: { multi?: string } };
}

export interface VisNetworkInstance {
    on(
        event: 'click' | 'hoverNode' | 'blurNode' | 'hoverEdge' | 'blurEdge',
        cb: (params: VisEventParams) => void,
    ): void;
    off(event: 'click' | 'hoverNode' | 'blurNode' | 'hoverEdge' | 'blurEdge'): void;
    destroy(): void;
    /** vis-network's body holds raw DataSet refs; we use it for edge-color mutation. */
    body: {
        data: {
            edges: {
                update: (e: Partial<VisNetworkEdge> & { id: string }) => void;
                getIds: () => string[];
            };
            nodes: { update: (n: Partial<VisNetworkNode> & { id: string }) => void };
        };
    };
}

export interface VisEventParams {
    nodes: string[];
    edges: string[];
    /** Pointer position for context menus; unused by loop 15 click-arc. */
    pointer?: { canvas: { x: number; y: number } };
}

// ---------------------------------------------------------------------------
// buildVisNodes / buildVisEdges — pure tree-to-vis-shape transforms.
// ---------------------------------------------------------------------------

/**
 * Walk a folder tree and emit one `VisNetworkNode` per non-empty folder.
 * The synthetic empty root (`path: ''`, `name: ''`) is skipped so the
 * top-level entries are the user-visible roots.
 */
export function buildVisNodes(root: FolderNode): VisNetworkNode[] {
    const out: VisNetworkNode[] = [];
    const walk = (node: FolderNode): void => {
        // Skip the synthetic empty root (path: '', name: '') — same skip
        // rule as PackageView's render() / renderNode().
        if (node.path !== '' || node.name !== '') {
            out.push({
                id: node.path,
                label: node.name,
                shape: 'box',
                title: `${node.path} (${node.fileCount} files)`,
            });
        }
        for (const child of node.children) walk(child);
    };
    walk(root);
    return out;
}

export interface BuildVisEdgesOptions {
    /** When true, ignore `weightP90` and emit every edge. */
    readonly showAllEdges: boolean;
}

/**
 * Build vis-network edges from a `FolderEdgelistData`. The `showAllEdges`
 * flag is taken explicitly — there is no global state in this module.
 *
 * Edge id format: `${kind}|${from}|${to}` (consumed by `parseEdgeId`).
 * After loop-08 bucketing, at most one edge per (kind, from, to) tuple
 * exists, so the id is unique within an edgelist.
 *
 * Color encodes kind: imports are blue (`#5b8def`), calls are orange
 * (`#e8a23a`). Loop 16 will move these to CSS variables.
 */
export function buildVisEdges(
    edgeList: FolderEdgelistData,
    opts: BuildVisEdgesOptions,
): VisNetworkEdge[] {
    const threshold = opts.showAllEdges ? 0 : edgeList.weightP90;
    const out: VisNetworkEdge[] = [];
    for (let i = 0; i < edgeList.edges.length; i++) {
        const e = edgeList.edges[i];
        if (e.weight < threshold) continue;
        const id = `${e.kind}|${e.from}|${e.to}`;
        out.push({
            id,
            from: e.from,
            to: e.to,
            width: Math.min(1 + Math.log2(e.weight + 1), 6),
            label: String(e.weight),
            color: e.kind === 'import' ? '#5b8def' : '#e8a23a',
            title: `${e.kind}: ${e.from} → ${e.to} (weight ${e.weight})`,
            __folderEdge: e,
        });
    }
    return out;
}
