/**
 * Edge Renderer - No D3
 * 
 * Renders edges as SVG paths using plain DOM.
 */

import { VisEdge } from '../types';

export class EdgeRenderer {
    private svg: SVGGElement;
    private defs: SVGDefsElement;

    constructor(svg: SVGGElement, parentSvg: SVGSVGElement) {
        this.svg = svg;

        // Create arrowhead markers
        this.defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

        this.defs.innerHTML = `
            <marker id="arrowhead" viewBox="0 -5 10 10" refX="15" refY="0" 
                    markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,-5L10,0L0,5" fill="var(--edge-color, #999)" />
            </marker>
            <marker id="arrowhead-highlighted" viewBox="0 -5 10 10" refX="15" refY="0" 
                    markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,-5L10,0L0,5" fill="var(--edge-highlight-color, #007acc)" />
            </marker>
        `;

        parentSvg.insertBefore(this.defs, parentSvg.firstChild);
    }

    /**
     * Render all edges.
     */
    render(
        edges: VisEdge[],
        positions: Map<string, { x: number; y: number }>
    ): void {
        this.svg.innerHTML = '';

        let rendered = 0;
        let skipped = 0;
        const skippedSamples: string[] = [];

        for (const edge of edges) {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (!from || !to) {
                skipped++;
                if (skippedSamples.length < 5) {
                    skippedSamples.push(`${edge.from} -> ${edge.to} (from: ${!!from}, to: ${!!to})`);
                }
                continue;
            }

            this.renderEdge(edge, from, to);
            rendered++;
        }

        console.log(`[EdgeRenderer] Edges: ${rendered} rendered, ${skipped} skipped (total: ${edges.length})`);
        if (skippedSamples.length > 0) {
            console.log('[EdgeRenderer] Sample skipped edges:', skippedSamples);
        }
    }

    /**
     * Render a single edge.
     */
    private renderEdge(
        edge: VisEdge,
        from: { x: number; y: number },
        to: { x: number; y: number }
    ): void {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'edge-path');
        path.setAttribute('data-from', edge.from);
        path.setAttribute('data-to', edge.to);
        path.setAttribute('d', this.generatePath(from, to));
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'var(--edge-color, #999)');
        path.setAttribute('stroke-width', '1');
        path.setAttribute('stroke-opacity', '0.5');
        path.setAttribute('marker-end', 'url(#arrowhead)');

        this.svg.appendChild(path);
    }

    /**
     * Generate curved path.
     */
    private generatePath(
        from: { x: number; y: number },
        to: { x: number; y: number }
    ): string {
        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;

        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.sqrt(dx * dx + dy * dy);

        if (len === 0) {
            return `M${from.x},${from.y}L${to.x},${to.y}`;
        }

        const curvature = 0.12;
        const offsetX = -dy / len * len * curvature;
        const offsetY = dx / len * len * curvature;

        const ctrlX = midX + offsetX;
        const ctrlY = midY + offsetY;

        return `M${from.x},${from.y}Q${ctrlX},${ctrlY} ${to.x},${to.y}`;
    }

    /**
     * Highlight edges for a node.
     */
    highlightEdgesForNode(nodeId: string): void {
        const paths = this.svg.querySelectorAll('.edge-path');
        paths.forEach(path => {
            const from = path.getAttribute('data-from');
            const to = path.getAttribute('data-to');
            const isConnected = from === nodeId || to === nodeId;

            if (isConnected) {
                path.classList.add('highlighted');
                path.setAttribute('stroke', 'var(--edge-highlight-color, #007acc)');
                path.setAttribute('stroke-width', '2');
                path.setAttribute('stroke-opacity', '1');
                path.setAttribute('marker-end', 'url(#arrowhead-highlighted)');
            } else {
                path.classList.add('faded');
                path.setAttribute('stroke-opacity', '0.1');
            }
        });
    }

    /**
     * Clear highlights.
     */
    clearHighlight(): void {
        const paths = this.svg.querySelectorAll('.edge-path');
        paths.forEach(path => {
            path.classList.remove('highlighted', 'faded');
            path.setAttribute('stroke', 'var(--edge-color, #999)');
            path.setAttribute('stroke-width', '1');
            path.setAttribute('stroke-opacity', '0.5');
            path.setAttribute('marker-end', 'url(#arrowhead)');
        });
    }

    /**
     * Get neighbor IDs.
     */
    getNeighbors(nodeId: string, edges: VisEdge[]): Set<string> {
        const neighbors = new Set<string>();
        for (const edge of edges) {
            if (edge.from === nodeId) neighbors.add(edge.to);
            if (edge.to === nodeId) neighbors.add(edge.from);
        }
        return neighbors;
    }

    /**
     * Highlight all edges connected to any node in the set.
     */
    highlightEdgesForNodes(nodeIds: Set<string>): void {
        const paths = this.svg.querySelectorAll('.edge-path');
        paths.forEach(path => {
            const from = path.getAttribute('data-from');
            const to = path.getAttribute('data-to');
            const isConnected = nodeIds.has(from || '') || nodeIds.has(to || '');

            if (isConnected) {
                path.classList.add('highlighted');
                path.setAttribute('stroke', 'var(--edge-highlight-color, #007acc)');
                path.setAttribute('stroke-width', '2');
                path.setAttribute('stroke-opacity', '1');
                path.setAttribute('marker-end', 'url(#arrowhead-highlighted)');
            } else {
                path.classList.add('faded');
                path.setAttribute('stroke-opacity', '0.1');
            }
        });
    }
}
