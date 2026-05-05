/**
 * Folder view-model — pure, DOM-free derivations for PackageView.
 *
 * Loop 15 split: every helper that previously lived as a `private` method
 * on `PackageView.ts` and did NOT touch the DOM moves here. Function-only
 * exports — no classes, no `window.*`, no `document.*`. Esbuild elides
 * unused exports cleanly so the runtime bundle does not pay for unused
 * helpers.
 *
 * This module is the unit-test surface for the package-view code path —
 * see `tests/unit/web-viewer/folder-view-model.test.ts` (Task 8) for the
 * pinned contract on every export below.
 *
 * Cross-references:
 *   - `folderOf` mirrors `src/graph/folder-edges.ts:101-105` byte-for-byte
 *     for the relative-path domain. The browser bundle cannot drag in
 *     `node:path`, so this is an intentional duplicate (parity-tested).
 *   - `parseEdgeId` is the canonical decoder for the edge-id format
 *     produced by `buildVisEdges` (`${kind}|${from}|${to}`).
 *   - `readmeKeyCandidates` mirrors the directory branch of
 *     `DesignTextView.fetchDesignDoc` (`src/webview/ui/components/
 *     DesignTextView.ts:466-475`).
 */

import type { FolderNode } from '../../../contracts/folder-tree';
import type { FolderEdgelistData, FolderEdge } from '../../../contracts/folder-edges';
import type { DesignDoc } from '../types';

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
// folderOf — browser-pure mirror of src/graph/folder-edges.ts:101-105.
//
// Rules (mirrored from the canonical impl):
//   1. Replace all backslashes with forward slashes.
//   2. Find the last forward slash; the folder is everything before it.
//   3. If there's no slash (top-level file), folder is '.'.
//
// The browser bundle cannot drag in `node:path`, so this is an
// intentional duplicate. Parity is pinned by
// tests/unit/web-viewer/folder-view-model.test.ts against
// `path.posix.dirname` for the relative-path domain that FolderEdge
// endpoints inhabit.
// ---------------------------------------------------------------------------

export function folderOf(fileId: string): string {
    const normalized = fileId.replaceAll('\\', '/');
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash === -1) return '.';
    return normalized.slice(0, lastSlash);
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

// ---------------------------------------------------------------------------
// parseEdgeId — decode the `${kind}|${from}|${to}` format.
// ---------------------------------------------------------------------------

export interface ParsedEdgeId {
    readonly kind: 'import' | 'call';
    readonly from: string;
    readonly to: string;
}

/**
 * Decode an edge id produced by `buildVisEdges`. Returns `null` when the
 * id is malformed (wrong segment count or unknown kind) so callers can
 * use a single `if (parsed === null) return;` guard instead of two
 * separate defensive checks.
 */
export function parseEdgeId(edgeId: string): ParsedEdgeId | null {
    const parts = edgeId.split('|');
    if (parts.length !== 3) return null;
    const [kind, from, to] = parts;
    if (kind !== 'import' && kind !== 'call') return null;
    return { kind, from, to };
}

/**
 * Look up the underlying `FolderEdge` for a vis-network edge id.
 * Takes the edgelist explicitly — the view-model layer never reads
 * mutable state.
 */
export function findFolderEdgeById(
    edgeList: FolderEdgelistData,
    edgeId: string,
): FolderEdge | null {
    const parsed = parseEdgeId(edgeId);
    if (parsed === null) return null;
    for (const e of edgeList.edges) {
        if (e.kind === parsed.kind && e.from === parsed.from && e.to === parsed.to) {
            return e;
        }
    }
    return null;
}

/**
 * Given the rendered edge ids and a hovered folder, return the subset
 * of ids whose endpoints exclude the hovered folder. The caller mutates
 * vis-network state (fade those edges) — this function is pure.
 *
 * Malformed ids (`parseEdgeId` returns null) are skipped: they are not
 * incident to anything, but mutating them would also be a no-op in
 * practice. Matching the PackageView original behavior.
 */
export function nonIncidentEdgeIds(
    renderedEdgeIds: readonly string[],
    hoveredFolder: string,
): string[] {
    const out: string[] = [];
    for (const edgeId of renderedEdgeIds) {
        const parsed = parseEdgeId(edgeId);
        if (parsed === null) continue;
        const isIncident = parsed.from === hoveredFolder || parsed.to === hoveredFolder;
        if (!isIncident) out.push(edgeId);
    }
    return out;
}

// ---------------------------------------------------------------------------
// README key candidates — directory-branch of DesignTextView.fetchDesignDoc.
// ---------------------------------------------------------------------------

/**
 * Probe order for a folder's README in `designDocs`:
 *   1. `<path>/README.html`  — output of the .md → .html converter pipeline
 *   2. `<path>/README.txt`   — plain-text fallback some hosts emit
 *   3. `<path>/README.md`    — original markdown
 *
 * Same order as `DesignTextView.fetchDesignDoc:466-475`.
 */
export function readmeKeyCandidates(folderPath: string): string[] {
    return [
        `${folderPath}/README.html`,
        `${folderPath}/README.txt`,
        `${folderPath}/README.md`,
    ];
}

/**
 * First-hit lookup of a folder's README in a `designDocs` map.
 * Returns `null` (not `undefined`) on miss — callers can rely on a
 * single `=== null` guard.
 */
export function resolveReadmeDoc(
    designDocs: Record<string, DesignDoc>,
    folderPath: string,
): DesignDoc | null {
    for (const key of readmeKeyCandidates(folderPath)) {
        const doc = designDocs[key];
        if (doc !== undefined) return doc;
    }
    return null;
}
