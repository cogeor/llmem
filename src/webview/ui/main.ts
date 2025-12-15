
import { state } from './state';
import { ThemeManager } from './theme';
import { Router } from './router';
import { createDataProvider } from './services/dataProviderFactory';
import { Worktree } from './components/Worktree';
import { ViewToggle } from './components/ViewToggle';
import { GraphTypeToggle } from './components/GraphTypeToggle';
import { DesignTextView } from './components/DesignTextView';
import { GraphView } from './components/GraphView';
import { Splitter } from './libs/Splitter';

// Create data provider for this environment (auto-detects VS Code vs standalone)
const dataProvider = createDataProvider();

// Elements
const elWorktree = document.getElementById('worktree-root') as HTMLElement;
const elViewToggle = document.getElementById('view-toggle') as HTMLElement;
const elGraphToggle = document.getElementById('graph-type-toggle') as HTMLElement;
const elDesignView = document.getElementById('design-view') as HTMLElement;
const elGraphView = document.getElementById('graph-view') as HTMLElement;

// Splitter elements
const elSplitter1 = document.getElementById('splitter-1') as HTMLElement;
const elSplitter2 = document.getElementById('splitter-2') as HTMLElement;
const elExplorerPane = document.getElementById('explorer-pane') as HTMLElement;
const elDesignPane = document.getElementById('design-pane') as HTMLElement;
const elGraphPane = document.getElementById('graph-pane') as HTMLElement;

// Helper to detect VS Code environment
declare const acquireVsCodeApi: any;
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
    if (elGraphPane) elGraphPane.style.flex = '1';
    console.log('[Webview] Running in graph-only mode');
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
const worktree = new Worktree({
    el: elWorktree,
    state,
    dataProvider
});

const viewToggle = new ViewToggle({
    el: elViewToggle,
    state
});

const graphTypeToggle = new GraphTypeToggle({
    el: elGraphToggle,
    state
});

const designTextView = new DesignTextView({
    el: elDesignView,
    state,
    dataProvider
});

const graphView = new GraphView({
    el: elGraphView,
    state,
    dataProvider
});

// Register Routes
router.registerRoute('design', designTextView);
router.registerRoute('graph', graphView);

// Subscribe to refresh events (hot reload)
dataProvider.onRefresh(async () => {
    console.log('[Webview] Refresh triggered - reloading components');
    await Promise.all([
        worktree.mount(),
        graphView.mount(),
        designTextView.mount()
    ]);
});

// Bootstrap
(async () => {
    try {
        // Init Router first to handle initial visibility
        router.init();

        // Theme
        const themeManager = new ThemeManager();
        document.getElementById('theme-toggle')?.addEventListener('click', () => themeManager.toggle());

        // Mount all components
        await Promise.all([
            worktree.mount(),
            viewToggle.mount(),
            graphTypeToggle.mount(),
            designTextView.mount(),
            graphView.mount()
        ]);

        console.log("Webview initialized");
    } catch (e) {
        console.error("Initialization failed", e);
    }
})();
