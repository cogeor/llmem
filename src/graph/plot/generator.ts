import * as fs from 'fs';
import { Graph, Node, Edge } from '../types';
import { getHtmlTemplate } from './template';

interface VisNode {
    id: string;
    label: string;
    title: string; // Tooltip
    group?: string;
}

interface VisEdge {
    from: string;
    to: string;
    title?: string; // Tooltip for edges (e.g., import specifiers)
}

function formatTooltip(obj: any): string {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
        if (key === 'id' || key === 'label' || key === 'kind') continue;
        if (value === undefined || value === null) continue;

        let valStr = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
        // Truncate long values
        if (valStr.length > 200) valStr = valStr.substring(0, 200) + '...';

        lines.push(`<b>${key}:</b> ${valStr}`);
    }
    return lines.join('<br/>');
}

export function generatePlotHtml<N extends Node, E extends Edge>(graph: Graph<N, E>, title: string): string {
    const visNodes: VisNode[] = Array.from(graph.nodes.values()).map(n => ({
        id: n.id,
        label: n.label,
        group: (n as any).kind || 'default',
        title: `<b>${n.label}</b><hr/>${formatTooltip(n)}`
    }));

    const visEdges: VisEdge[] = graph.edges.map(e => ({
        from: e.source,
        to: e.target,
        title: formatTooltip(e)
    }));

    const data = {
        nodes: visNodes,
        edges: visEdges
    };

    return getHtmlTemplate(JSON.stringify(data), title);
}

export function savePlot<N extends Node, E extends Edge>(graph: Graph<N, E>, title: string, outputPath: string) {
    const html = generatePlotHtml(graph, title);
    fs.writeFileSync(outputPath, html, 'utf-8');
    console.log(`Plot saved to ${outputPath}`);
}
