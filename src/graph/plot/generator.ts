import { Graph, Node, Edge } from '../types';
import { getHtmlTemplate } from './template';
import { ColorGenerator } from '../utils';
import { createLogger } from '../../common/logger';
import type { WorkspaceIO } from '../../workspace/workspace-io';

const log = createLogger('plot-generator');

interface VisNode {
    id: string;
    label: string;
    title: string; // Tooltip
    group?: string;
    color?: string; // HSL color
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
    const colorGen = new ColorGenerator();
    const nodeColors = colorGen.generateColors(graph.nodes.values());

    const visNodes: VisNode[] = Array.from(graph.nodes.values()).map(n => ({
        id: n.id,
        label: n.label,
        group: (n as any).kind || 'default',
        title: `<b>${n.label}</b><hr/>${formatTooltip(n)}`,
        color: nodeColors.get(n.id)
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

/**
 * Persist a generated plot HTML to disk.
 *
 * Loop 24: signature flipped from `(graph, title, outputPath)` to
 * `(graph, title, io, outputRel)`. Writes go through `WorkspaceIO` so the
 * destination is realpath-validated against the workspace root. The
 * `outputRel` argument is workspace-relative (forward slashes preferred).
 */
export async function savePlot<N extends Node, E extends Edge>(
    graph: Graph<N, E>,
    title: string,
    io: WorkspaceIO,
    outputRel: string,
): Promise<void> {
    const html = generatePlotHtml(graph, title);
    await io.writeFile(outputRel, html);
    log.info('Plot saved', { outputRel });
}
