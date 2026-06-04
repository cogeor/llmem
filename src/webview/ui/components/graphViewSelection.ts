/**
 * Pure selection-patch builders for `GraphView` graph-click handlers.
 *
 * Extracted from `components/GraphView.ts` (Loop 22 file-size split).
 * Pure browser code — no node/vscode imports. `parseGraphId` comes from
 * `src/core/ids`, which is browser-safe (no Node-only deps).
 *
 * Each builder returns the exact `state.set(...)` patch the inline handler
 * used to construct, so behaviour is unchanged — only the construction
 * moved out of the component.
 */

import { AppState } from "../types";
import { parseGraphId } from "../../../core/ids";

type SelectionPatch = Pick<AppState, 'selectedPath' | 'selectedType' | 'selectionSource'>;

/**
 * Resolve a graph node click into a file selection. Entity node IDs select
 * their containing file (Loop 03 bugfix); plain file node IDs select
 * themselves.
 */
export function nodeClickSelection(nodeId: string): SelectionPatch {
    const parsed = parseGraphId(nodeId);
    const filePath = parsed.kind === 'entity' ? parsed.fileId : nodeId;
    return {
        selectedPath: filePath,
        selectedType: 'file',
        selectionSource: 'graph',
    };
}

/** Selection patch for a folder click from the graph. */
export function folderClickSelection(folderPath: string): SelectionPatch {
    return {
        selectedPath: folderPath,
        selectedType: 'directory',
        selectionSource: 'graph',
    };
}

/** Selection patch for a file click from the graph. */
export function fileClickSelection(filePath: string): SelectionPatch {
    return {
        selectedPath: filePath,
        selectedType: 'file',
        selectionSource: 'graph',
    };
}
