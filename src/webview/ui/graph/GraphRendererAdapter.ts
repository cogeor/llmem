
import { VisNode, VisEdge } from '../types';

interface RenderData {
    nodes: VisNode[];
    edges: VisEdge[];
}

interface RenderOptions {
    selectedId?: string | null;
}

/**
 * Adapter for Vis.js Network
 */
export class GraphRendererAdapter {
    container: HTMLElement;
    network: any | null; // vis.Network
    onNodeClick: (nodeId: string) => void;
    currentData: RenderData;

    /**
     * @param container 
     * @param onNodeClick - callback(nodeId)
     */
    constructor(container: HTMLElement, onNodeClick?: (nodeId: string) => void) {
        this.container = container;
        this.network = null;
        this.onNodeClick = onNodeClick || (() => { });
        this.currentData = { nodes: [], edges: [] };
    }

    render(data: RenderData, options: RenderOptions = {}) {
        this.currentData = data;
        const { selectedId } = options;

        // Get current theme color from CSS variable
        const style = getComputedStyle(document.body);
        const textColor = style.getPropertyValue('--foreground').trim() || '#cccccc';

        const visOptions = {
            nodes: {
                shape: 'dot',
                size: 16,
                font: {
                    size: 14,
                    color: textColor,
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
            nodes: new window.vis.DataSet(displayNodes),
            edges: new window.vis.DataSet(data.edges)
        };

        if (this.network) {
            this.network.setOptions(visOptions);
            this.network.setData(displayData);
        } else {
            this.network = new window.vis.Network(this.container, displayData, visOptions);
            this.network.on('click', (params: any) => {
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
