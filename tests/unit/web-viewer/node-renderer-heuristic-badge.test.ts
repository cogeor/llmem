// tests/unit/web-viewer/node-renderer-heuristic-badge.test.ts
//
// PC-04 — pin the per-node heuristic badge contract in NodeRenderer.
//
// A heuristic-language call-graph node (e.g. Python, name-matched) with no
// edges otherwise looks like a genuine leaf — misleading. The renderer badges
// `callGraph === 'heuristic'` nodes with a distinct style + a 'heuristic'
// tooltip. Semantic (TS/JS), 'none', and absent capabilities stay UNBADGED
// (absence of badge = trusted).
//
// Two layers are pinned:
//   1) the pure `heuristicBadge(node)` decision (no DOM)
//   2) the rendered SVG <g> for a heuristic vs semantic node (JSDOM)
//
// JSDOM harness mirrors `package-view.test.ts`: window/document globals are
// pinned BEFORE requiring the renderer so its `document.createElementNS`
// calls land on the jsdom instance.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window as unknown;
g.document = dom.window.document;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
    NodeRenderer,
    heuristicBadge,
    HEURISTIC_NODE_CLASS,
    HEURISTIC_NODE_TITLE,
} = require('../../../src/webview/ui/graph/NodeRenderer') as {
    NodeRenderer: new (svg: SVGGElement) => {
        render(
            nodes: Array<Record<string, unknown>>,
            positions: Map<string, { x: number; y: number }>,
            nodeColors: Map<string, string>,
        ): void;
    };
    heuristicBadge: (node: { callGraph?: 'semantic' | 'heuristic' | 'none' }) => {
        isHeuristic: boolean;
        className?: string;
        title?: string;
    };
    HEURISTIC_NODE_CLASS: string;
    HEURISTIC_NODE_TITLE: string;
};

// --- Pure decision: heuristicBadge ------------------------------------------

test('heuristicBadge: heuristic node is badged with class + title', () => {
    const badge = heuristicBadge({ callGraph: 'heuristic' });
    assert.equal(badge.isHeuristic, true);
    assert.equal(badge.className, HEURISTIC_NODE_CLASS);
    assert.equal(badge.title, HEURISTIC_NODE_TITLE);
    assert.match(badge.title!, /heuristic/i);
});

test('heuristicBadge: semantic node is NOT badged', () => {
    const badge = heuristicBadge({ callGraph: 'semantic' });
    assert.equal(badge.isHeuristic, false);
    assert.equal(badge.className, undefined);
    assert.equal(badge.title, undefined);
});

test('heuristicBadge: "none" and absent capability are NOT badged', () => {
    assert.equal(heuristicBadge({ callGraph: 'none' }).isHeuristic, false);
    assert.equal(heuristicBadge({}).isHeuristic, false);
});

// --- Rendered SVG -----------------------------------------------------------

function renderOne(node: Record<string, unknown>): SVGGElement {
    const svgRoot = document.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGGElement;
    const renderer = new NodeRenderer(svgRoot);
    const positions = new Map([[node.id as string, { x: 0, y: 0 }]]);
    renderer.render([node], positions, new Map());
    return svgRoot.querySelector('.node-group') as SVGGElement;
}

test('NodeRenderer: heuristic node gets the heuristic class + a <title> tooltip', () => {
    const grp = renderOne({ id: 'pkg/mod.py#a', label: 'a', group: 'function', callGraph: 'heuristic' });
    assert.ok(grp, 'expected a rendered .node-group');
    assert.ok(grp.classList.contains(HEURISTIC_NODE_CLASS), 'heuristic node must carry the heuristic class');

    const titleEl = grp.querySelector('title');
    assert.ok(titleEl, 'heuristic node must have an SVG <title> tooltip');
    assert.equal(titleEl!.textContent, HEURISTIC_NODE_TITLE);

    const circle = grp.querySelector('circle');
    assert.ok(circle!.getAttribute('stroke-dasharray'), 'heuristic node circle uses a dashed border');
});

test('NodeRenderer: semantic node has no heuristic class and no <title>', () => {
    const grp = renderOne({ id: 'src/mod.ts#a', label: 'a', group: 'function', callGraph: 'semantic' });
    assert.ok(grp, 'expected a rendered .node-group');
    assert.equal(grp.classList.contains(HEURISTIC_NODE_CLASS), false, 'semantic node must NOT be badged');
    assert.equal(grp.querySelector('title'), null, 'semantic node must NOT have a heuristic tooltip');
    assert.equal(grp.querySelector('circle')!.getAttribute('stroke-dasharray'), null);
});
