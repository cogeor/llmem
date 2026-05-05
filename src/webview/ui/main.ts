
import { state } from './state';
import { ThemeManager } from './theme';
import { Router } from './router';
import { createDataProvider } from './services/dataProviderFactory';
import { Worktree } from './components/Worktree';
import { GraphTypeToggle } from './components/GraphTypeToggle';
import { DesignModeToggle } from './components/DesignModeToggle';
import { DesignTextView } from './components/DesignTextView';
import { GraphView } from './components/GraphView';
import { PackageView } from './components/PackageView';
import { FolderStructureView } from './components/FolderStructureView';
import { ViewToggle } from './components/ViewToggle';
import { Splitter } from './libs/Splitter';
import { explorerIcon, designIcon, graphIcon, sun } from './icons';
import { requireElement } from './dom-validation';
import '../live-reload'; // WebSocket live reload for HTTP server mode

// Helper to detect VS Code environment. The full API surface is private to
// `VSCodeDataProvider`; the global is only declared here so we can probe
// for it (Loop 14: components must not call `acquireVsCodeApi` directly).
// `declare` must live at module scope (TS forbids it inside a block), so
// it is hoisted out of the loop-02 top-level try/catch below.
declare const acquireVsCodeApi: () => { postMessage(msg: unknown): void };

try {

// Create data provider for this environment (auto-detects VS Code vs standalone)
const dataProvider = createDataProvider();

// Elements — `requireElement` (loop 02) replaces the previous
// `as HTMLElement` casts so a missing mount-point ID surfaces a clear
// error at the lookup site rather than as a `Cannot read properties of
// null` from inside a downstream component constructor.
const elWorktree = requireElement('worktree-root');
const elDesignModeToggle = requireElement('design-mode-toggle');
const elGraphToggle = requireElement('graph-type-toggle');
const elDesignView = requireElement('design-view');
const elGraphView = requireElement('graph-view');
const elPackageView = requireElement('package-view');
const elFolderStructureView = requireElement('folder-structure-view');
const elViewToggle = requireElement('view-toggle');

// Splitter elements
const elSplitter1 = requireElement('splitter-1');
const elSplitter2 = requireElement('splitter-2');
const elExplorerPane = requireElement('explorer-pane');
const elDesignPane = requireElement('design-pane');
const elGraphPane = requireElement('graph-pane');

const isVsCode = typeof acquireVsCodeApi !== 'undefined';

// Detect graph-only mode (no WORK_TREE means graph-only, but ONLY in standalone mode)
// In VS Code, data might arrive later via messages, so we default to showing everything.
const isGraphOnlyMode = !isVsCode && !window.WORK_TREE;

if (isGraphOnlyMode) {

    // Hide Explorer and Design panes, expand Graph to full width
    if (elExplorerPane) elExplorerPane.style.display = 'none';
    if (elDesignPane) elDesignPane.style.display = 'none';
    if (elSplitter1) elSplitter1.style.display = 'none';
    if (elSplitter2) elSplitter2.style.display = 'none';
    if (elGraphPane) {
        elGraphPane.style.flex = '1';
        elGraphPane.style.width = '100%';
        // Ensure proper flex behavior
        elGraphPane.style.maxWidth = 'none';
    }
    console.log('[Webview] Running in graph-only mode');
    // Force graph view since design view is unavailable
    state.set({ currentView: 'graph' });
}

// Init Splitters (only if not in graph-only mode)
if (!isGraphOnlyMode && elSplitter1 && elExplorerPane) {
    new Splitter(elSplitter1, elExplorerPane, 'left');
}
if (!isGraphOnlyMode && elSplitter2 && elDesignPane) {
    new Splitter(elSplitter2, elDesignPane, 'left');
}


// Router
const router = new Router({
    state,
    container: document.body
});

// Components - inject dataProvider
// We only init Worktree and DesignView if not in graph-only mode
let worktree: Worktree | undefined;
let designModeToggle: DesignModeToggle | undefined;
let designTextView: DesignTextView | undefined;

if (!isGraphOnlyMode) {
    worktree = new Worktree({
        el: elWorktree,
        state,
        dataProvider
    });

    designTextView = new DesignTextView({
        el: elDesignView,
        state,
        dataProvider
    });

    designModeToggle = new DesignModeToggle({
        el: elDesignModeToggle,
        state,
        onSave: () => {
            // Trigger save in DesignTextView
            if (designTextView) {
                (designTextView as any).triggerSave();
            }
        }
    });
}

const graphTypeToggle = new GraphTypeToggle({
    el: elGraphToggle,
    state
});

const graphView = new GraphView({
    el: elGraphView,
    state,
    dataProvider
});

const packageView = new PackageView({
    el: elPackageView,
    state,
    dataProvider
});

const folderStructureView = new FolderStructureView({
    el: elFolderStructureView,
    state,
    dataProvider,
});

// Header view toggle (Graph / Design / Packages / Folders).
const viewToggle = new ViewToggle({
    el: elViewToggle,
    state,
});

// Register Routes
if (designTextView) {
    router.registerRoute('design', designTextView);
}
router.registerRoute('graph', graphView);
router.registerRoute('packages', packageView);
router.registerRoute('folders', folderStructureView);

// Subscribe to refresh events (hot reload)
dataProvider.onRefresh(async () => {
    console.log('[Webview] Refresh triggered - reloading graph');
    // Only refresh graph view - Worktree structure doesn't change on edge refresh
    await graphView.mount();
    if (designTextView) await designTextView.mount();
    await folderStructureView.mount();
});

// Subscribe to watched paths restoration (persisted state from disk)
if (dataProvider.onWatchedPathsRestored) {
    dataProvider.onWatchedPathsRestored((paths: string[]) => {
        console.log(`[Webview] Restoring ${paths.length} watched paths`);
        state.set({ watchedPaths: new Set(paths) });
    });
}

// Initialize watched paths from window.WATCHED_FILES (for static mode)
if (!isVsCode && (window as any).WATCHED_FILES) {
    const watchedFiles = (window as any).WATCHED_FILES as string[];
    console.log(`[Webview] Initializing ${watchedFiles.length} watched paths from static data`);
    state.set({ watchedPaths: new Set(watchedFiles) });
}

// Inject header icons. Arrow-function form keeps the declaration valid
// inside the loop-02 top-level try block (the `function` form would trip
// `no-inner-declarations`).
const initHeaderIcons = () => {
    const explorerTitle = document.querySelector('#explorer-title .pane-icon');
    const designTitle = document.querySelector('#design-title .pane-icon');
    const graphTitle = document.querySelector('#graph-title .pane-icon');
    const themeToggle = document.getElementById('theme-toggle');

    // safe: author-controlled SVG icon string from icons.ts
    if (explorerTitle) explorerTitle.innerHTML = explorerIcon;
    // safe: author-controlled SVG icon string from icons.ts
    if (designTitle) designTitle.innerHTML = designIcon;
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
            graphView.mount(),
            packageView.mount(),
            folderStructureView.mount(),
        ];

        if (worktree) mountPromises.push(worktree.mount());
        if (designModeToggle) mountPromises.push(designModeToggle.mount());
        if (designTextView) mountPromises.push(designTextView.mount());

        await Promise.all(mountPromises);

        console.log("Webview initialized");
    } catch (e) {
        console.error("Initialization failed", e);
    }
})();

} catch (e) {
    // Loop 02: surface element-lookup errors that fire at module-evaluation
    // time (before the async bootstrap IIFE runs) so the user sees a
    // useful banner instead of a blank panel.
    console.error('[webview/main] Initialization failed', e);
    const body = document.body;
    if (body) {
        const banner = document.createElement('pre');
        banner.style.cssText = 'color:#c00;padding:16px;font:12px monospace;white-space:pre-wrap;';
        banner.textContent = `LLMem webview failed to initialize:\n${e instanceof Error ? e.message : String(e)}`;
        body.appendChild(banner);
    }
    throw e; // re-raise so VS Code surfaces it in the dev console
}
