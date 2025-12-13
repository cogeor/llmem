import { state } from './state.js';
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

// Bootstrap
(async () => {
    try {
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
