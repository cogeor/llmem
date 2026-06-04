/**
 * Edge formatting — browser-pure edge-id decode + incidence helpers
 * (Loop 15 split).
 *
 * Carved verbatim from the former `folderViewModel.ts` monolith:
 * `parseEdgeId`, `findFolderEdgeById`, and `nonIncidentEdgeIds` — the decoders
 * for the `${kind}|${from}|${to}` edge-id format produced by `buildVisEdges`.
 *
 * Browser-pure: function-only, no `window.*`, `document.*`, `node:*`, or
 * `vscode` imports. Re-exported through the `folderViewModel.ts` barrel.
 */

import type { FolderEdgelistData, FolderEdge } from '../../../../contracts/folder-edges';

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
