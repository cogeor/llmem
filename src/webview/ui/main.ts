
import { state } from './state';
import { ThemeManager } from './theme';
import { Router } from './router';
import { createDataProvider } from './services/dataProviderFactory';
import { createWebviewLogger } from './services/webview-logger';
import { Worktree } from './components/Worktree';
import { GraphTypeToggle } from './components/GraphTypeToggle';
import { HealthHighlightToggle } from './components/HealthHighlightToggle';
import { GraphView } from './components/GraphView';
import { renderSmellList } from './graph/HealthOverlayRenderer';
import { FolderStructureView } from './components/FolderStructureView';
import { ViewToggle } from './components/ViewToggle';
import { FolderDescriptionPanel } from './components/FolderDescriptionPanel';
import { SummaryPanel } from './components/SummaryPanel';
import { Splitter } from './libs/Splitter';
import { explorerIcon, graphIcon, sun } from './icons';
import { requireElement } from './dom-validation';
import '../live-reload'; // WebSocket live reload for HTTP server mode

// Helper to detect VS Code environment. The full API surface is private to
// `VSCodeDataProvider`; the global is only declared here so we can probe
// for it (Loop 14: components must not call `acquireVsCodeApi` directly).
// `declare` must live at module scope (TS forbids it inside a block), so
// it is hoisted out of the loop-02 top-level try/catch below.
declare const acquireVsCodeApi: () => { postMessage(msg: unknown): void };

// Loop 14: construct the single browser logger BEFORE the top-level try
// so the outer catch handler (fatal-bootstrap path) can also route
// through `logger.error`. The factory has no side effects beyond closure
// creation, so it cannot itself throw.
// Asymmetric gating: error/warn always emit; log/debug gated on
// `window.LLMEM_DEBUG`.
const logger = createWebviewLogger({ enabled: Boolean(window.LLMEM_DEBUG) });

try {

// Create data provider for this environment (auto-detects VS Code vs standalone)
const dataProvider = createDataProvider(logger);

// Elements — `requireElement` (loop 02) replaces the previous
// `as HTMLElement` casts so a missing mount-point ID surfaces a clear
// error at the lookup site rather than as a `Cannot read properties of
// null` from inside a downstream component constructor.
const elWorktree = requireElement('worktree-root');
const elGraphToggle = requireElement('graph-type-toggle');
const elGraphView = requireElement('graph-view');
const elFolderStructureView = requireElement('folder-structure-view');
const elViewToggle = requireElement('view-toggle');
const elSummaryPanel = requireElement('folder-summary-panel');
const elHealthToggle = requireElement('health-highlight-toggle');
const elHealthSmellList = requireElement('health-smell-list');

// Splitter elements
const elSplitter1 = requireElement('splitter-1');
const elExplorerPane = requireElement('explorer-pane');
const elGraphPane = requireElement('graph-pane');

const isVsCode = typeof acquireVsCodeApi !== 'undefined';

// Detect graph-only mode (no WORK_TREE means graph-only, but ONLY in standalone mode)
// In VS Code, data might arrive later via messages, so we default to showing everything.
const isGraphOnlyMode = !isVsCode && !window.WORK_TREE;

if (isGraphOnlyMode) {

    // Hide the Explorer pane, expand Graph to full width
    if (elExplorerPane) elExplorerPane.style.display = 'none';
    if (elSplitter1) elSplitter1.style.display = 'none';
    if (elGraphPane) {
        elGraphPane.style.flex = '1';
        elGraphPane.style.width = '100%';
        // Ensure proper flex behavior
        elGraphPane.style.maxWidth = 'none';
    }
    logger.log('[Webview] Running in graph-only mode');
    // Force graph view since design view is unavailable
    state.set({ currentView: 'graph' });
}

// Init Splitter (only if not in graph-only mode)
if (!isGraphOnlyMode && elSplitter1 && elExplorerPane) {
    new Splitter(elSplitter1, elExplorerPane, 'left');
}


// Router
const router = new Router({
    state,
    container: document.body
});

// Components - inject dataProvider
// We only init the Worktree explorer if not in graph-only mode.
let worktree: Worktree | undefined;

if (!isGraphOnlyMode) {
    worktree = new Worktree({
        el: elWorktree,
        state,
        dataProvider,
        logger,
    });
}

const graphTypeToggle = new GraphTypeToggle({
    el: elGraphToggle,
    state
});

const healthHighlightToggle = new HealthHighlightToggle({
    el: elHealthToggle,
    state,
});

const graphView = new GraphView({
    el: elGraphView,
    state,
    dataProvider,
    logger,
});

const folderStructureView = new FolderStructureView({
    el: elFolderStructureView,
    state,
    dataProvider,
});

// Header view toggle (Graph / Folders).
const viewToggle = new ViewToggle({
    el: elViewToggle,
    state,
});

// Docked summary panel (VS-A1 mount). Mounts in both VS Code + standalone
// and is independent of graph-only mode — with no docs it simply stays
// hidden. The FolderDescriptionPanel is a (mostly) pure renderer; the
// SummaryPanel controller owns the pinned exact/ancestor/empty +
// toggle-on-reclick state machine and resolves via resolveClosestDoc.
const summaryRenderer = new FolderDescriptionPanel({
    el: elSummaryPanel,
    designDocs: window.DESIGN_DOCS || {},
    logger,
});
const summaryPanel = new SummaryPanel({
    panel: summaryRenderer,
    designDocs: window.DESIGN_DOCS || {},
});
state.subscribe((s) => {
    summaryPanel.onSelection(s.selectedPath, s.selectedType);
});

// Loop 08: drive the health overlay (clone edges + smell badges) from the
// `healthHighlight` flag, and the detail-panel smell list from the current
// selection. The list is shown only when health-highlight is on AND the
// selected node carries smells; otherwise it's hidden.
let lastHealthHighlight = state.get().healthHighlight;
state.subscribe((s) => {
    if (s.healthHighlight !== lastHealthHighlight) {
        lastHealthHighlight = s.healthHighlight;
        graphView.setHealthHighlight(s.healthHighlight);
    }
    const smells =
        s.healthHighlight && s.selectedPath
            ? graphView.getNodeSmells(s.selectedPath)
            : undefined;
    renderSmellList(elHealthSmellList, smells);
});

// Register Routes
router.registerRoute('graph', graphView);
router.registerRoute('folders', folderStructureView);

// Live-refresh the summary panel (VS-A4). Re-pull the docs map and push it
// into the controller, which re-resolves the CURRENT selection so an edited /
// added / deleted doc updates the open panel without a manual reselect.
// `loadDesignDocs()` is the host-agnostic source:
//   - static / serve: StaticDataProvider returns designDocCache.getAll(),
//     which has already applied the incremental arch:* WebSocket events, so it
//     reflects the just-changed docs (no /api/arch full-map fetch needed — the
//     cache IS the full map). Limitation: serve mode relies on the cache being
//     seeded from window.DESIGN_DOCS + kept current by the WebSocket deltas;
//     there is no whole-map endpoint and we do not add one here.
//   - VS Code: returns the regenerated designDocs from the panel echo.
// Guard: a missing / graph-only doc source yields {} → panel hides; never
// throws.
const refreshSummaryDocs = async (): Promise<void> => {
    try {
        const docs = (await dataProvider.loadDesignDocs()) || {};
        summaryPanel.refreshDocs(docs);
    } catch (e) {
        logger.error('[Webview] Summary-panel doc refresh failed', e);
        summaryPanel.refreshDocs({});
    }
};

// Subscribe to refresh events (hot reload). Single onRefresh registration —
// graph + folder views AND the summary-panel docs map all refresh through this
// one handler (no double-subscription / leak). This fires on graph-edge
// updates (StaticDataProvider's `graph:updated`) and on VS Code data echoes.
dataProvider.onRefresh(async () => {
    logger.log('[Webview] Refresh triggered - reloading graph');
    // Only refresh graph + folder views - Worktree structure doesn't change on edge refresh
    await graphView.mount();
    await folderStructureView.mount();
    // Refresh docs AFTER the graph/folder re-mount so the doc re-resolve does
    // not race the graph mount (await order: graph first, then docs).
    await refreshSummaryDocs();
});

// In serve / static mode a pure arch edit (no graph change) flows through the
// designDocCache → `onDesignDocChange`, NOT `onRefresh` (which only fires on
// `graph:updated`). Subscribe to it as well so editing/regenerating a doc
// live-updates the open summary panel even when the graph is unchanged. This
// is a DISTINCT hook from onRefresh (not a double onRefresh subscription); the
// cache has already applied the delta before the callback fires, so we just
// re-pull the whole map. The optional method is absent in VS Code mode (where
// `onRefresh` already carries the regenerated docs), so this is guarded.
if (dataProvider.onDesignDocChange) {
    dataProvider.onDesignDocChange(() => {
        logger.log('[Webview] Design doc changed - refreshing summary panel');
        void refreshSummaryDocs();
    });
}

// Subscribe to watched paths restoration (persisted state from disk)
if (dataProvider.onWatchedPathsRestored) {
    dataProvider.onWatchedPathsRestored((paths: string[]) => {
        logger.log(`[Webview] Restoring ${paths.length} watched paths`);
        state.set({ watchedPaths: new Set(paths) });
    });
}

// Initialize watched paths from window.WATCHED_FILES (for static mode)
if (!isVsCode && (window as any).WATCHED_FILES) {
    const watchedFiles = (window as any).WATCHED_FILES as string[];
    logger.log(`[Webview] Initializing ${watchedFiles.length} watched paths from static data`);
    state.set({ watchedPaths: new Set(watchedFiles) });
}

// Inject header icons. Arrow-function form keeps the declaration valid
// inside the loop-02 top-level try block (the `function` form would trip
// `no-inner-declarations`).
const initHeaderIcons = () => {
    const explorerTitle = document.querySelector('#explorer-title .pane-icon');
    const graphTitle = document.querySelector('#graph-title .pane-icon');
    const themeToggle = document.getElementById('theme-toggle');

    // safe: author-controlled SVG icon string from icons.ts
    if (explorerTitle) explorerTitle.innerHTML = explorerIcon;
    // safe: author-controlled SVG icon string from icons.ts
    if (graphTitle) graphTitle.innerHTML = graphIcon;
    // safe: author-controlled SVG icon string from icons.ts (ThemeManager updates this later)
    if (themeToggle) themeToggle.innerHTML = sun;
};

// Bootstrap
(async () => {
    try {
        // Init header icons immediately
        initHeaderIcons();

        // Init Router first to handle initial visibility
        router.init();

        // Theme
        const themeManager = new ThemeManager();
        document.getElementById('theme-toggle')?.addEventListener('click', () => themeManager.toggle());

        // Mount all components
        viewToggle.mount();
        const mountPromises = [
            graphTypeToggle.mount(),
            healthHighlightToggle.mount(),
            graphView.mount(),
            folderStructureView.mount(),
        ];

        if (worktree) mountPromises.push(worktree.mount());

        await Promise.all(mountPromises);

        logger.log("Webview initialized");
    } catch (e) {
        logger.error("Initialization failed", e);
    }
})();

} catch (e) {
    // Loop 02: surface element-lookup errors that fire at module-evaluation
    // time (before the async bootstrap IIFE runs) so the user sees a
    // useful banner instead of a blank panel.
    // Loop 14: `logger` is hoisted above the try block so this fatal-
    // bootstrap branch routes through it; `error` always emits regardless
    // of `window.LLMEM_DEBUG`.
    logger.error('[webview/main] Initialization failed', e);
    const body = document.body;
    if (body) {
        const banner = document.createElement('pre');
        banner.style.cssText = 'color:#c00;padding:16px;font:12px monospace;white-space:pre-wrap;';
        banner.textContent = `LLMem webview failed to initialize:\n${e instanceof Error ? e.message : String(e)}`;
        body.appendChild(banner);
    }
    throw e; // re-raise so VS Code surfaces it in the dev console
}
