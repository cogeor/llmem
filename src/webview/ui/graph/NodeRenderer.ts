/**
 * Node Renderer - No D3
 * 
 * Renders nodes as circles with labels using plain SVG DOM.
 */

import { VisNode } from '../types';

const NODE_RADIUS = 8;
const LABEL_OFFSET = 12;

export class NodeRenderer {
    private svg: SVGGElement;
    private positions: Map<string, { x: number; y: number }> = new Map();
    private nodeColors: Map<string, string> = new Map();
    private onNodeClick?: (nodeId: string) => void;
    private onNodeHover?: (nodeId: string | null) => void;

    constructor(svg: SVGGElement) {
        this.svg = svg;
    }

    /**
     * Render all nodes.
     */
    render(
        nodes: VisNode[],
        positions: Map<string, { x: number; y: number }>,
        nodeColors: Map<string, string>,
        onNodeClick?: (nodeId: string) => void,
        onNodeHover?: (nodeId: string | null) => void
    ): void {
        this.positions = positions;
        this.nodeColors = nodeColors;
        this.onNodeClick = onNodeClick;
        this.onNodeHover = onNodeHover;

        // Clear previous
        this.svg.innerHTML = '';

        for (const node of nodes) {
            const pos = positions.get(node.id);
            if (!pos) continue;

            this.renderNode(node, pos);
        }
    }

    /**
     * Render a single node.
     */
    private renderNode(node: VisNode, pos: { x: number; y: number }): void {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'node-group');
        g.setAttribute('data-id', node.id);
        // Store fileId for folder matching (call graph uses fileId, import graph uses id)
        g.setAttribute('data-file-id', node.fileId || node.id);
        g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
        g.style.cursor = 'pointer';

        // Circle
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('r', String(NODE_RADIUS));
        circle.setAttribute('fill', this.nodeColors.get(node.id) || node.color || '#6c757d');
        circle.setAttribute('stroke', '#fff');
        circle.setAttribute('stroke-width', '1.5');

        g.appendChild(circle);

        // Label
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', '0');
        text.setAttribute('y', String(LABEL_OFFSET + NODE_RADIUS));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('font-size', '8');
        text.setAttribute('font-weight', '600');
        text.setAttribute('fill', 'var(--node-label-color, #333)');
        text.setAttribute('pointer-events', 'none');
        text.textContent = this.truncateLabel(node.label || node.id);

        g.appendChild(text);

        // Events
        g.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onNodeClick?.(node.id);
        });

        g.addEventListener('mouseenter', () => {
            this.onNodeHover?.(node.id);
        });

        g.addEventListener('mouseleave', () => {
            this.onNodeHover?.(null);
        });

        this.svg.appendChild(g);
    }

    /**
     * Highlight a node and its neighbors.
     */
    highlightNode(nodeId: string, neighborIds?: Set<string>): void {
        this.clearHighlight();

        const groups = this.svg.querySelectorAll('.node-group');
        groups.forEach(g => {
            const id = g.getAttribute('data-id');
            const circle = g.querySelector('circle');

            if (id === nodeId) {
                g.classList.add('highlighted');
                if (circle) {
                    circle.setAttribute('r', String(NODE_RADIUS * 1.5));
                    circle.setAttribute('stroke-width', '3');
                }
            } else if (neighborIds?.has(id || '')) {
                g.classList.add('neighbor');
            } else {
                g.classList.add('faded');
            }
        });
    }

    /**
     * Clear highlights.
     */
    clearHighlight(): void {
        const groups = this.svg.querySelectorAll('.node-group');
        groups.forEach(g => {
            g.classList.remove('highlighted', 'neighbor', 'faded');
            const circle = g.querySelector('circle');
            if (circle) {
                circle.setAttribute('r', String(NODE_RADIUS));
                circle.setAttribute('stroke-width', '1.5');
            }
        });
    }

    /**
     * Extract and return the name part of a label (no truncation).
     */
    private truncateLabel(label: string): string {
        const parts = label.split(/[\/\\:#]/);
        return parts[parts.length - 1] || label;
    }

    /**
     * Highlight all nodes within a folder path.
     */
    highlightNodesInFolder(folderPath: string): void {
        console.log('[NodeRenderer] highlightNodesInFolder called:', folderPath);
        this.clearHighlight();

        const normalizedFolder = folderPath.replace(/\\/g, '/');
        console.log('[NodeRenderer] Normalized folder:', normalizedFolder);

        const groups = this.svg.querySelectorAll('.node-group');
        console.log('[NodeRenderer] Found', groups.length, 'node groups');

        let matchCount = 0;
        groups.forEach(g => {
            // Use data-file-id for folder matching (handles call graph nodes correctly)
            const fileId = g.getAttribute('data-file-id') || g.getAttribute('data-id') || '';
            const normalizedFileId = fileId.replace(/\\/g, '/');
            const circle = g.querySelector('circle');

            // Check if node is in folder (path starts with folderPath)
            const isMatch = normalizedFileId.startsWith(normalizedFolder + '/') || normalizedFileId === normalizedFolder;

            if (isMatch) {
                matchCount++;
                g.classList.add('highlighted');
                if (circle) {
                    circle.setAttribute('stroke-width', '2');
                }
            } else {
                g.classList.add('faded');
            }
        });
        console.log('[NodeRenderer] Matched', matchCount, 'nodes');
    }

    /**
     * Highlight nodes in folder and their neighbors.
     */
    highlightNodesInFolderWithNeighbors(folderPath: string, neighbors: Set<string>): void {
        this.clearHighlight();

        const normalizedFolder = folderPath.replace(/\\/g, '/');

        const groups = this.svg.querySelectorAll('.node-group');
        groups.forEach(g => {
            const id = g.getAttribute('data-id') || '';
            const fileId = g.getAttribute('data-file-id') || id;
            const normalizedFileId = fileId.replace(/\\/g, '/');
            const circle = g.querySelector('circle');

            const isInFolder = normalizedFileId.startsWith(normalizedFolder + '/') || normalizedFileId === normalizedFolder;
            const isNeighbor = neighbors.has(id);

            if (isInFolder) {
                g.classList.add('highlighted');
                if (circle) {
                    circle.setAttribute('stroke-width', '3');
                }
            } else if (isNeighbor) {
                g.classList.add('neighbor');
                if (circle) {
                    circle.setAttribute('stroke-width', '2');
                }
            } else {
                g.classList.add('faded');
            }
        });
    }
}
