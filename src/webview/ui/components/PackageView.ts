/**
 * PackageView — orchestration component for the packages route (Loop 15).
 *
 * Loop 15 split this file from a 770-line monolith into a thin orchestrator
 * over four child components and a pure view-model:
 *
 *   - `FolderCardList`         — folder-card tree DOM
 *   - `FolderArcNetwork`       — vis-network arc visualization + controls
 *   - `FolderDescriptionPanel` — README rendering for the selected folder
 *   - `EdgeDrilldownPanel`     — bottom drill-down panel for arc clicks
 *   - `folderViewModel.ts`     — DOM-free derivations
 *
 * Responsibilities that remain in this file:
 *   1. Async data load (tree + edges + designDocs) with the existing
 *      three-tier try/catch fallbacks (loop-14/15 contract).
 *   2. The shell template render (the four mount-point divs).
 *   3. Child component construction + callback wiring to `state.set`.
 *   4. State subscription → description-panel show/hide.
 *   5. `unmount` lifecycle.
 */

import type { FolderTreeData } from '../../../graph/folder-tree';
import type { FolderEdgelistData, FolderEdge } from '../../../graph/folder-edges';
import { DataProvider } from '../services/dataProvider';
import { State } from '../state';
import { AppState, DesignDoc } from '../types';
import { escape } from '../utils/escape';
import { WebviewLogger, createWebviewLogger } from '../services/webview-logger';
import { FolderCardList } from './FolderCardList';
import { FolderArcNetwork } from './FolderArcNetwork';
import { FolderDescriptionPanel } from './FolderDescriptionPanel';
import { EdgeDrilldownPanel } from './EdgeDrilldownPanel';

interface Props {
    el: HTMLElement;
    state: State;
    dataProvider: DataProvider;
    logger?: WebviewLogger;
}

export class PackageView {
    public el: HTMLElement;
    private state: State;
    private dataProvider: DataProvider;
    private logger: WebviewLogger;

    private tree: FolderTreeData | null = null;
    private edges: FolderEdgelistData | null = null;
    private designDocs: Record<string, DesignDoc> = {};

    private cardList: FolderCardList | null = null;
    private arcNetwork: FolderArcNetwork | null = null;
    private descriptionPanel: FolderDescriptionPanel | null = null;
    private edgePanel: EdgeDrilldownPanel | null = null;

    private unsubscribe?: () => void;

    constructor({ el, state, dataProvider, logger }: Props) {
        this.el = el;
        this.state = state;
        this.dataProvider = dataProvider;
        this.logger = logger ?? createWebviewLogger({ enabled: false });
    }

    async mount(): Promise<void> {
        // Tier 1: tree load. Failure renders the loop-14 empty state and
        // never reaches the edge / designDocs blocks.
        try {
            this.tree = await this.dataProvider.loadFolderTree();
        } catch (err) {
            const safeMessage = escape(
                String((err as Error)?.message ?? 'Failed to load folder tree'),
            );
            // safe: structural template; message is escape()-wrapped.
            this.el.innerHTML = `<div class="package-empty">${safeMessage}</div>`;
            return;
        }

        // Tier 2: edges. Failure → cards-only fallback (loop-14 contract).
        try {
            this.edges = await this.dataProvider.loadFolderEdges();
        } catch (err) {
            this.logger.warn(
                '[PackageView] loadFolderEdges failed; rendering cards-only.',
                err,
            );
            this.edges = null;
        }

        // Render the shell template + materialize child mount points.
        this.renderShell();

        // Tier 3: designDocs. Failure → description panel disabled
        // (loop-16 contract; the cards/arcs render is unaffected).
        try {
            this.designDocs = await this.dataProvider.loadDesignDocs();
        } catch (err) {
            this.logger.warn(
                '[PackageView] loadDesignDocs failed; description panel disabled.',
                err,
            );
            this.designDocs = {};
        }

        this.constructChildren();
        if (this.tree !== null) this.cardList?.render(this.tree.root);
        if (this.tree !== null) this.arcNetwork?.render(this.tree, this.edges);

        this.unsubscribe = this.state.subscribe((s: AppState) => this.onStateChange(s));
    }

    unmount(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.cardList?.unmount();
        this.arcNetwork?.unmount();
        this.descriptionPanel?.unmount();
        this.edgePanel?.unmount();
        this.cardList = null;
        this.arcNetwork = null;
        this.descriptionPanel = null;
        this.edgePanel = null;
        this.el.innerHTML = '';
        this.tree = null;
        this.edges = null;
        this.designDocs = {};
    }

    // -----------------------------------------------------------------
    // private — orchestration plumbing
    // -----------------------------------------------------------------

    private renderShell(): void {
        // safe: structural template; class names are author-controlled
        // literals; no user data interpolated.
        this.el.innerHTML = `
            <div class="package-controls"></div>
            <div class="package-tree"></div>
            <div class="package-arc-container"></div>
            <div class="package-description-panel" style="display:none;"></div>
            <div class="package-bottom-panel" style="display:none;"></div>
        `;
    }

    private constructChildren(): void {
        const controlsEl = this.el.querySelector('.package-controls') as HTMLElement | null;
        const treeEl = this.el.querySelector('.package-tree') as HTMLElement | null;
        const arcEl = this.el.querySelector('.package-arc-container') as HTMLElement | null;
        const descEl = this.el.querySelector(
            '.package-description-panel',
        ) as HTMLElement | null;
        const bottomEl = this.el.querySelector('.package-bottom-panel') as HTMLElement | null;

        if (treeEl !== null) {
            this.cardList = new FolderCardList({
                el: treeEl,
                onCardClick: (folderPath: string): void => {
                    this.state.set({
                        selectedPath: folderPath,
                        selectedType: 'directory',
                        selectionSource: 'graph',
                    });
                },
                logger: this.logger,
            });
        }

        if (descEl !== null) {
            this.descriptionPanel = new FolderDescriptionPanel({
                el: descEl,
                designDocs: this.designDocs,
                logger: this.logger,
            });
        }

        if (bottomEl !== null) {
            this.edgePanel = new EdgeDrilldownPanel({
                el: bottomEl,
                onFileEdgeNavigate: (filePath: string): void => {
                    this.state.set({
                        currentView: 'graph',
                        selectedPath: filePath,
                        selectedType: 'file',
                        selectionSource: 'graph',
                    });
                },
                logger: this.logger,
            });
        }

        if (arcEl !== null && controlsEl !== null) {
            this.arcNetwork = new FolderArcNetwork({
                arcEl,
                controlsEl,
                onNodeClick: (folderPath: string): void => {
                    this.state.set({
                        currentView: 'graph',
                        selectedPath: folderPath,
                        selectedType: 'directory',
                        selectionSource: 'graph',
                    });
                },
                onEdgeClick: (folderEdge: FolderEdge): void => {
                    this.edgePanel?.show(folderEdge);
                },
                onEmptyClick: (): void => {
                    this.edgePanel?.hide();
                },
                logger: this.logger,
            });
        }
    }

    /**
     * React to state changes. Only the 'packages' route renders the
     * description panel — bail out for other routes so we don't leak a
     * stale README into the design pane.
     */
    private onStateChange(s: AppState): void {
        if (s.currentView !== 'packages') return;
        if (s.selectedType !== 'directory' || s.selectedPath === null) {
            this.descriptionPanel?.hide();
            return;
        }
        this.descriptionPanel?.show(s.selectedPath);
    }
}
