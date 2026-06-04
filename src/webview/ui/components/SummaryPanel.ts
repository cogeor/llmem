/**
 * SummaryPanel — docked summary-panel controller (VS-A3).
 *
 * Owns the PINNED state machine that maps the app-state selection
 * (`selectedPath` / `selectedType`) onto the (mostly) pure
 * `FolderDescriptionPanel` renderer. Resolution is delegated to the pure
 * `resolveClosestDoc` (folderViewModel.ts) so this controller stays the
 * single place that decides exact-vs-ancestor-vs-empty and the
 * toggle-on-reclick behavior.
 *
 * Browser-pure — no `window`, `document`, `fetch`, or Node imports — so the
 * state machine is unit-testable in isolation (see
 * tests/unit/web-viewer/summary-panel.test.ts).
 *
 * STATE MACHINE (tracks `currentKey` + the `currentPath` that produced the
 * current view):
 *   - EXACT    : resolved.inherited === false → showResolved(exact);
 *                currentKey = resolved.key.
 *   - ANCESTOR : resolved.inherited === true  → showResolved(inherited)
 *                with an "inherited from <key>" marker;
 *                currentKey = resolved.key.
 *   - EMPTY    : resolved === null → showEmpty(path); currentKey = EMPTY_KEY
 *                (a non-null sentinel so a re-click can toggle the hint off).
 *   - RECLICK-TOGGLE (RULE B): clicking the SAME path whose SAME key is
 *                already shown → hide() + clear state. The toggle fires ONLY
 *                when BOTH the selected path AND the resolved key match the
 *                currently-shown selection+key. A descendant that resolves
 *                to the same ancestor key has a DIFFERENT path, so it never
 *                accidentally toggles — it swaps/keeps-open instead.
 *   - SWAP     : a selection resolving to a different (path,key) → render
 *                the new resolution + update currentKey/currentPath.
 *   - CLEARED  : selectedPath === null (or selectedType === null) → hide().
 */

import type { DesignDoc } from '../types';
import { resolveClosestDoc } from './folderViewModel';

/** The minimal renderer surface the controller drives. */
export interface SummaryPanelRenderer {
    showResolved(key: string, doc: DesignDoc, inherited: boolean): void;
    showEmpty(path: string): void;
    hide(): void;
    /**
     * Replace the renderer's own design-docs map (used by its independent
     * `show()` path). Optional so test stubs need not implement it; the
     * real `FolderDescriptionPanel` provides it.
     */
    setDesignDocs?(docs: Record<string, DesignDoc>): void;
}

export interface SummaryPanelProps {
    /** The renderer (a FolderDescriptionPanel, or a stub in tests). */
    panel: SummaryPanelRenderer;
    /** Bundle of design docs keyed by output path (e.g. window.DESIGN_DOCS). */
    designDocs: Record<string, DesignDoc>;
}

// Sentinel key for the EMPTY state. Real bundle keys always contain a '.'
// (file-form `${k}.html`) or a '/README.' segment, so this sentinel can
// never collide with a resolved key — RULE B's (path,key) compare is safe.
const EMPTY_KEY = '__LLMEM_EMPTY_SUMMARY__';

export class SummaryPanel {
    private readonly panel: SummaryPanelRenderer;
    private designDocs: Record<string, DesignDoc>;

    /** The bundle key currently shown, or null when the panel is hidden. */
    private currentKey: string | null = null;
    /** The selected path that produced the current view (RULE B compare). */
    private currentPath: string | null = null;
    /**
     * The selected type that produced the current view. Retained so
     * `refreshDocs` can re-run `resolveClosestDoc` against the new map for
     * the SAME selection (re-resolution needs both path AND type).
     */
    private currentType: 'file' | 'directory' | null = null;

    constructor(props: SummaryPanelProps) {
        this.panel = props.panel;
        this.designDocs = props.designDocs;
    }

    /** Expose the current key for tests / debugging. */
    getCurrentKey(): string | null {
        return this.currentKey;
    }

    /**
     * Replace the in-memory designDocs map (e.g. on a websocket update).
     * Does not re-render — the next selection change re-resolves.
     */
    setDesignDocs(docs: Record<string, DesignDoc>): void {
        this.designDocs = docs;
    }

    /**
     * Drive the state machine from an app-state selection. Call this from
     * `state.subscribe`.
     */
    onSelection(
        selectedPath: string | null,
        selectedType: 'file' | 'directory' | null,
    ): void {
        // CLEARED: no selection → hide and reset.
        if (selectedPath === null || selectedType === null) {
            this.reset();
            return;
        }

        const resolved = resolveClosestDoc(this.designDocs, selectedPath, selectedType);
        const nextKey = resolved === null ? EMPTY_KEY : resolved.key;

        // RULE B (reclick-toggle): close ONLY when re-clicking the EXACT
        // same selection — both the path AND the resolved key must match the
        // currently-shown view. A descendant resolving to the same ancestor
        // key differs in `path`, so it swaps/keeps-open and never toggles.
        if (this.currentPath === selectedPath && this.currentKey === nextKey) {
            this.reset();
            return;
        }

        // EMPTY: nothing resolved up to the root.
        if (resolved === null) {
            this.panel.showEmpty(selectedPath);
            this.currentKey = EMPTY_KEY;
            this.currentPath = selectedPath;
            this.currentType = selectedType;
            return;
        }

        // EXACT (inherited === false) or ANCESTOR (inherited === true) —
        // the renderer draws the inherited marker when `inherited` is true.
        this.panel.showResolved(resolved.key, resolved.doc, resolved.inherited);
        this.currentKey = resolved.key;
        this.currentPath = selectedPath;
        this.currentType = selectedType;
    }

    /**
     * Re-pull the docs map (e.g. on a websocket arch-update) and re-render
     * the CURRENT selection against it, WITHOUT going through the toggle
     * machinery (a refresh must never toggle the panel closed).
     *
     * Behavior:
     *   - Swaps in the new map (also pushes it into the renderer so the
     *     renderer's own `show()` path stays consistent).
     *   - If nothing is currently shown (`currentPath`/`currentType` null),
     *     there is nothing to re-resolve — just keep the new map.
     *   - Otherwise re-resolve the SAME (currentPath, currentType) against the
     *     new map and re-render:
     *       · resolves to a doc → showResolved with the (possibly changed)
     *         §11 exact/inherited flag (an EXACT doc may become INHERITED
     *         after deletion, or vice-versa) and update currentKey.
     *       · resolves to null   → the shown doc was deleted with no ancestor
     *         remaining → hide() + clear state.
     *
     * Re-resolution preserves `currentPath`/`currentType` so a later reclick
     * still toggles correctly; only `currentKey` follows the new resolution.
     */
    refreshDocs(docs: Record<string, DesignDoc>): void {
        this.designDocs = docs;
        // Keep the renderer's internal map in sync (its `show()` path resolves
        // independently of the controller).
        if (this.panel.setDesignDocs) {
            this.panel.setDesignDocs(docs);
        }

        // Nothing shown → nothing to re-resolve.
        if (this.currentPath === null || this.currentType === null) {
            return;
        }

        const resolved = resolveClosestDoc(
            this.designDocs,
            this.currentPath,
            this.currentType,
        );

        // The shown doc (and any ancestor) is gone → hide + clear.
        if (resolved === null) {
            this.reset();
            return;
        }

        // Re-render with the refreshed resolution. `inherited` may have
        // flipped (exact→inherited after deletion, or inherited→exact after
        // an own-doc was added) — showResolved redraws the marker accordingly.
        this.panel.showResolved(resolved.key, resolved.doc, resolved.inherited);
        this.currentKey = resolved.key;
        // currentPath / currentType are intentionally preserved so a later
        // reclick on the same selection still toggles closed (RULE B).
    }

    /** Hide the panel and clear the pinned state. */
    private reset(): void {
        this.panel.hide();
        this.currentKey = null;
        this.currentPath = null;
        this.currentType = null;
    }
}
