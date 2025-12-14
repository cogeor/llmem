
import { state } from './state';
import { ThemeManager } from './theme';
import { Router } from './router';
import { WorktreeService } from './services/worktreeService';
import { GraphDataService } from './services/graphDataService';
import { DesignDocService } from './services/designDocService';
import { Worktree } from './components/Worktree';
import { ViewToggle } from './components/ViewToggle';
import { GraphTypeToggle } from './components/GraphTypeToggle';
import { DesignTextView } from './components/DesignTextView';
import { GraphView } from './components/GraphView';
import { Splitter } from './libs/Splitter';


// Elements
const elWorktree = document.getElementById('worktree-root') as HTMLElement;
const elViewToggle = document.getElementById('view-toggle') as HTMLElement;
const elGraphToggle = document.getElementById('graph-type-toggle') as HTMLElement;
const elContent = document.getElementById('content-area'); // Removed in new layout
const elDesignView = document.getElementById('design-view') as HTMLElement;
const elGraphView = document.getElementById('graph-view') as HTMLElement;

// Splitters
const elSplitter1 = document.getElementById('splitter-1') as HTMLElement;
const elSplitter2 = document.getElementById('splitter-2') as HTMLElement;
const elExplorerPane = document.getElementById('explorer-pane') as HTMLElement;
const elDesignPane = document.getElementById('design-pane') as HTMLElement;

// Init Splitters
if (elSplitter1 && elExplorerPane) {
    new Splitter(elSplitter1, elExplorerPane, 'left');
}
if (elSplitter2 && elDesignPane) {
    new Splitter(elSplitter2, elDesignPane, 'left');
}

// Services
const worktreeService = new WorktreeService();
const graphDataService = new GraphDataService();
const designDocService = new DesignDocService();

// Router
const router = new Router({
    state,
    container: document.body // Dummy container, we don't switch views anymore
});

// Components
const worktree = new Worktree({
    el: elWorktree,
    state,
    worktreeService
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
    designDocService
});

const graphView = new GraphView({
    el: elGraphView,
    state,
    graphDataService,
    worktreeService
});

// Register Routes
router.registerRoute('design', designTextView);
router.registerRoute('graph', graphView);

// Bootstrap
(async () => {
    try {

        // Init Router FIRST to handle initial visibility
        router.init();

        // Theme
        const themeManager = new ThemeManager();
        document.getElementById('theme-toggle')?.addEventListener('click', () => themeManager.toggle());

        // Mount static components
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
