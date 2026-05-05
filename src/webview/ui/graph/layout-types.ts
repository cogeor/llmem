/**
 * Layout DTOs for the hierarchical graph layout pass.
 *
 * Loop 16 — replaces the untyped `_x / _y / _relX / _relY / _localX /
 * _localY` scratch-field pattern with a typed sidecar map.
 *
 * Rule: type-only, no runtime. No classes, no DOM, no logger calls.
 *
 * Why a sidecar `Map<string, MeasuredNode>` rather than extending
 * `VisNode`: `VisNode` is the upstream contract with the data layer
 * (`src/webview/ui/types.ts`); the layout engine's per-pass scratch
 * fields have no business polluting the wire shape. Keeping
 * measurement state in a parallel Map keyed by `VisNode.id` lets the
 * input array stay read-only — the contract `compute()`'s JSDoc has
 * always implied.
 */

import type { VisNode } from '../types';

/**
 * Per-pass measurement state for a single `VisNode`. Keyed by
 * `VisNode.id` in the engine's measurement map. The builder
 * initialises every numeric field to `0`; `finalized` starts `false`
 * and flips to `true` once `finalizeNodePositions` has visited the
 * node — that flag is what distinguishes a legitimately-at-origin
 * node from one missed by an earlier pass.
 */
export interface MeasuredNode {
    readonly id: string;
    /** Local within the per-file block (set in compute step 1). */
    localX: number;
    localY: number;
    /** Relative to the folder origin (set in compute step 1). */
    relX: number;
    relY: number;
    /** Absolute coordinates (set in finalize step 4). */
    x: number;
    y: number;
    /** True iff `finalizeNodePositions` has visited this node. */
    finalized: boolean;
}

/**
 * Pulled out of the inline `FileBlock` interface that lived inside
 * `computeNodePositionsRelative`. Generalised to "block of nodes
 * within a folder".
 */
export interface FolderBlock {
    readonly path: string;
    readonly nodes: readonly VisNode[];
    width: number;
    height: number;
    x: number;
    y: number;
}

/**
 * Re-export of the canonical `PositionedNode`. Source of truth lives
 * in `./graphTypes` to avoid touching every renderer that already
 * imports it from there.
 */
export type { PositionedNode } from './graphTypes';

/** Convenience re-exports for layout consumers. */
export type { FolderRegion, FileRegion, LayoutResult } from './graphTypes';

/**
 * In-flight state object passed between private layout helpers.
 * `folderTree` stays opaque — `FolderNode` is internal to
 * `HierarchicalLayout.ts` and not on the loop-16 acceptance surface.
 */
export interface LayoutComputation {
    readonly folderTree: unknown;
    readonly measured: Map<string, MeasuredNode>;
}
