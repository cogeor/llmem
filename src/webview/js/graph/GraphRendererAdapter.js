/**
 * Adapter for Vis.js Network
 */
export class GraphRendererAdapter {
    /**
     * @param {HTMLElement} container 
     * @param {Function} onNodeClick - callback(nodeId)
     */
    constructor(container, onNodeClick) {
        this.container = container;
        this.network = null;
        this.onNodeClick = onNodeClick || (() => { });
        this.currentData = { nodes: [], edges: [] };
    }

    render(data, options = {}) {
        this.currentData = data;
        const { selectedId } = options;

        const visOptions = {
            nodes: {
                shape: 'dot',
                size: 16,
                font: {
                    size: 14,
                    color: '#cccccc', // fallback, should match theme
                    face: 'sans-serif'
                },
                borderWidth: 2,
            },
            edges: {
                color: { inherit: 'from', opacity: 0.6 },
                arrows: { to: { enabled: true, scaleFactor: 0.5 } },
                smooth: { type: 'continuous' }
            },
            physics: {
                stabilization: {
                    enabled: true,
                    iterations: 1000 // Force plenty of iterations to ensure stability before draw
                },
                barnesHut: {
                    gravitationalConstant: -8000,
                    springConstant: 0.04,
                    springLength: 95
                }
            },
            layout: {
                improvedLayout: true
            }
        };

        // Highlight selected node if provided
        // We clone nodes to avoid mutating original data
        const displayNodes = data.nodes.map(n => {
            if (n.id === selectedId) {
                return { ...n, color: { background: '#094771', border: '#007fd4' }, size: 20 };
            }
            return n;
        });

        const displayData = {
            nodes: new vis.DataSet(displayNodes),
            edges: new vis.DataSet(data.edges)
        };

        if (this.network) {
            this.network.setData(displayData);
        } else {
            this.network = new vis.Network(this.container, displayData, visOptions);
            this.network.on('click', (params) => {
                if (params.nodes.length > 0) {
                    this.onNodeClick(params.nodes[0]);
                }
            });
        }
    }

    destroy() {
        if (this.network) {
            this.network.destroy();
            this.network = null;
        }
    }
}
