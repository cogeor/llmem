import { state } from './state.js';
import { Router } from './router.js';
import { WorktreeService } from './services/worktreeService.js';
import { GraphDataService } from './services/graphDataService.js';
import { DesignDocService } from './services/designDocService.js';
import { Worktree } from './components/Worktree.js';
import { ViewToggle } from './components/ViewToggle.js';
import { GraphTypeToggle } from './components/GraphTypeToggle.js';
import { DesignTextView } from './components/DesignTextView.js';
import { GraphView } from './components/GraphView.js';
import { GraphRendererAdapter } from './graph/GraphRendererAdapter.js';

// Elements
const elWorktree = document.getElementById('worktree-root');
const elViewToggle = document.getElementById('view-toggle');
const elGraphToggle = document.getElementById('graph-type-toggle');
const elContent = document.getElementById('content-area'); // Shared container?
// Actually we likely want separate containers for Graph and Text view to easily toggle
const elDesignView = document.getElementById('design-view');
const elGraphView = document.getElementById('graph-view');

// Services
const worktreeService = new WorktreeService();
const graphDataService = new GraphDataService();
const designDocService = new DesignDocService();

// Renderer
// We pass the container element to the adapter
const graphRenderer = new GraphRendererAdapter(elGraphView, (nodeId) => {
    // On graph node click, do we want to select it in the tree?
    // Or just update selection state?
    // "Revision: When a file is selected..."
    // If user clicks a node in graph, we should probably update selection.
    // However, the graph is filtered BY selection.
    // If I click a neighbor, maybe I want to navigate to it?
    // Let's implement navigation on click.
    state.set({ selectedPath: nodeId, selectedType: 'file' });
});


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
    worktreeService,
    graphRenderer
});

// Register Routes
router.registerRoute('design', designTextView);
router.registerRoute('graph', graphView);

// Bootstrap
(async () => {
    try {
        // Init Router FIRST to handle initial visibility
        // This ensures containers are visible before GraphView tries to render (fixing vis.js centering)
        router.init();

        // Mount static components
        await Promise.all([
            worktree.mount(),
            viewToggle.mount(),
            graphTypeToggle.mount(),
            // designTextView.mount(), // Managed by Router? 
            // graphView.mount(),     // Managed by Router?
            // Actually, components still need to 'mount' to subscribe to state if they have other logic?
            // Yes, GraphView subscribes to update graph. DesignTextView subscribes to update content.
            // So we DO mount them. The Router just handles visibility.
            designTextView.mount(),
            graphView.mount()
        ]);

        console.log("Webview initialized");
    } catch (e) {
        console.error("Initialization failed", e);
    }
})();
