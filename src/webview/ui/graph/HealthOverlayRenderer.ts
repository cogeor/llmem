/**
 * HealthOverlayRenderer (Loop 08 / health-highlight).
 *
 * Pure-DOM home for the clone-edge amber-dashed paint, the smell-node badge,
 * and the detail-panel smell list — kept OUT of EdgeRenderer / NodeRenderer so
 * those stay thin and under budget. Every method is a pure DOM mutation (no
 * state import, no fetch), so the module is reusable and unit-testable in
 * isolation.
 *
 * Visual contract:
 *   - Clone edges get the `clone-edge` class (amber dashed via CSS). They are
 *     a SEPARATE concern from cycle red: this renderer NEVER touches an
 *     `.in-cycle` path (guarded), and the CSS `.clone-edge` rule does not
 *     out-specify the `.in-cycle !important` rule — cycle red keeps precedence
 *     and selection-immunity exactly as before.
 *   - Smelly nodes get the `node-smelly` class + a small badge `<circle>`.
 *   - The detail-panel smell list renders `severity · title` rows for the
 *     selected node's smells.
 */

import { VisEdge, VisNode } from '../types';
import { escape } from '../utils/escape';

/**
 * Apply (or clear) the amber-dashed clone-edge class. Driven by the prepared
 * `VisEdge[]` so the renderer knows which `data-from`/`data-to` paths are
 * clones. `on=false` removes the class (toggle-off).
 */
export function applyCloneEdges(
    edgesGroup: SVGGElement,
    edges: VisEdge[],
    on: boolean,
): void {
    if (!on) {
        edgesGroup.querySelectorAll('.edge-path.clone-edge').forEach((p) => {
            p.classList.remove('clone-edge');
        });
        return;
    }
    const cloneKeys = new Set<string>();
    for (const e of edges) {
        if (e.isClone) cloneKeys.add(`${e.from}->${e.to}`);
    }
    edgesGroup.querySelectorAll('.edge-path').forEach((p) => {
        // Cycle red owns the path — never repaint a cycle edge as a clone.
        if (p.classList.contains('in-cycle')) return;
        const from = p.getAttribute('data-from') || '';
        const to = p.getAttribute('data-to') || '';
        if (cloneKeys.has(`${from}->${to}`)) {
            p.classList.add('clone-edge');
        }
    });
}

/**
 * Apply (or clear) the smell badge on nodes carrying `smells`. `on=false`
 * removes the badge + class.
 */
export function applySmellBadges(
    nodesGroup: SVGGElement,
    nodes: VisNode[],
    on: boolean,
): void {
    if (!on) {
        nodesGroup.querySelectorAll('.node-group.node-smelly').forEach((g) => {
            g.classList.remove('node-smelly');
            g.querySelector('.node-smell-badge')?.remove();
        });
        return;
    }
    const smelly = new Set<string>();
    for (const n of nodes) {
        if (n.smells && n.smells.length > 0) smelly.add(n.id);
    }
    nodesGroup.querySelectorAll('.node-group').forEach((g) => {
        const id = g.getAttribute('data-id') || '';
        if (!smelly.has(id)) return;
        if (g.querySelector('.node-smell-badge')) return; // idempotent
        g.classList.add('node-smelly');
        const badge = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        badge.setAttribute('class', 'node-smell-badge');
        badge.setAttribute('cx', '7');
        badge.setAttribute('cy', '-7');
        badge.setAttribute('r', '3.5');
        g.appendChild(badge);
    });
}

/**
 * Render the smell list for a selected node into the detail-panel container.
 * When `smells` is empty/undefined the container is hidden. Pure DOM; the
 * caller looks up the selected node's `smells` from the loaded graph data.
 */
export function renderSmellList(
    el: HTMLElement,
    smells: VisNode['smells'] | undefined,
): void {
    if (!smells || smells.length === 0) {
        el.style.display = 'none';
        el.innerHTML = '';
        return;
    }
    const rows = smells
        .map(
            (s) =>
                `<li class="health-smell-row health-smell-${escape(s.severity)}">` +
                `<span class="health-smell-sev">${escape(s.severity)}</span>` +
                `<span class="health-smell-title">${escape(s.title)}</span></li>`,
        )
        .join('');
    // safe: severity/title are escape()-wrapped; the wrapping markup is
    // author-controlled literals.
    el.innerHTML = `<ul class="health-smell-list-items">${rows}</ul>`;
    el.style.display = 'block';
}
