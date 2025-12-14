
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

// Elements
const elWorktree = document.getElementById('worktree-root') as HTMLElement;
const elViewToggle = document.getElementById('view-toggle') as HTMLElement;
const elGraphToggle = document.getElementById('graph-type-toggle') as HTMLElement;
const elContent = document.getElementById('content-area') as HTMLElement;
const elDesignView = document.getElementById('design-view') as HTMLElement;
const elGraphView = document.getElementById('graph-view') as HTMLElement;

// Services
const worktreeService = new WorktreeService();
const graphDataService = new GraphDataService();
const designDocService = new DesignDocService();

// Router
const router = new Router({
    state,
    container: elContent
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
