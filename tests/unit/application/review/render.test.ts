// tests/unit/application/review/render.test.ts
//
// WS-3 — pure-function tests for the review-checklist renderer.
//
// Builds a real `ReviewChecklist` via the PURE `reviewRecallFromReport` (Loop 02)
// on a small hand-built HealthReport + ImportGraph fixture (reusing the recall
// test's `ig`/`cycle`/`emptyReport` helpers), ruleset 'both', then renders it
// with `renderReviewChecklist`. No IO, no scan. node:test style.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ImportGraph, ImportEdge } from '../../../../src/graph/types';
import type {
    HealthReport,
    CycleFinding,
} from '../../../../src/application/analysis/types';
import { zeroHealthVector } from '../../../../src/application/analysis/types';
import { reviewRecallFromReport } from '../../../../src/application/review/recall';
import { renderReviewChecklist } from '../../../../src/application/review/render';
import { REVIEW_REGISTRY } from '../../../../src/application/review/registry';

// ---- fixture helpers (mirrors recall.test.ts) -----------------------------

const ie = (source: string, target: string): ImportEdge =>
    ({ source, target, kind: 'import', specifiers: [] });

const ig = (ids: string[], edges: ImportEdge[]): ImportGraph => ({
    nodes: new Map(
        ids.map(id => [
            id,
            { id, kind: 'file', label: id, path: id, language: 'unknown' },
        ]),
    ),
    edges,
});

const cycle = (id: string, a: string, b: string): CycleFinding => ({
    id,
    type: 'import-cycle',
    kind: 'import-cycle',
    severity: 'medium',
    title: `import cycle ${a} ⇄ ${b}`,
    detail: `${a} and ${b} import each other`,
    relatedFiles: [a, b],
    members: [a, b].sort((x, y) => x.localeCompare(y)),
    shortestPath: [a, b, a],
});

const emptyReport = (over: Partial<HealthReport> = {}): HealthReport => ({
    repo: 'fixture',
    vector: zeroHealthVector(),
    importCycles: [],
    callCycles: [],
    recursion: [],
    clones: [],
    hubs: [],
    interfaceWidth: [],
    ...over,
});

const fixtureGraph = (): ImportGraph =>
    ig(
        [
            'src/webview/a.ts',
            'src/webview/b.ts',
            'src/graph/x.ts',
            'src/graph/y.ts',
        ],
        [
            ie('src/webview/a.ts', 'src/webview/b.ts'),
            ie('src/webview/b.ts', 'src/webview/a.ts'),
        ],
    );

// A ruleset 'both' checklist over src/webview with one in-subtree cycle so at
// least one entry (DEP1) carries candidates and the rest are graph-blind.
const buildChecklist = () =>
    reviewRecallFromReport(
        emptyReport({
            importCycles: [
                cycle('cyc:webview', 'src/webview/a.ts', 'src/webview/b.ts'),
            ],
        }),
        fixtureGraph(),
        'src/webview',
        'both',
    );

// ---- Case 1: every registry id gets a checkbox line -----------------------

test('renders a `- [ ] ` checkbox for EVERY registry item (no item dropped)', () => {
    const md = renderReviewChecklist(buildChecklist());

    const checkboxes = md.split('\n').filter(l => l.startsWith('- [ ] '));
    assert.equal(
        checkboxes.length,
        REVIEW_REGISTRY.length,
        'one checkbox per registry item (65 for ruleset both)',
    );
    assert.equal(checkboxes.length, 65, 'ruleset both renders all 65 items');

    // Every registry id appears on its own checkbox line — nothing skipped.
    for (const item of REVIEW_REGISTRY) {
        assert.ok(
            md.includes(`- [ ] ${item.id} — ${item.title}`),
            `item ${item.id} is present on a checkbox line`,
        );
    }
});

// ---- Case 2: byte-deterministic ------------------------------------------

test('rendering the same checklist twice is byte-identical', () => {
    const checklist = buildChecklist();
    assert.equal(
        renderReviewChecklist(checklist),
        renderReviewChecklist(checklist),
        'same checklist in → identical markdown out',
    );
});

// ---- Case 3: graph-blind item shows the exact sentinel line ---------------

test('a graph-blind item shows the exact "graph blind here, read for it" line', () => {
    const md = renderReviewChecklist(buildChecklist());
    const lines = md.split('\n');

    // FB1 (instruction) is graph-blind: find its checkbox line, then assert the
    // sentinel appears two lines below (checkbox → promptInstruction → sentinel).
    const fb1Idx = lines.findIndex(l => l.startsWith('- [ ] FB1 — '));
    assert.ok(fb1Idx !== -1, 'FB1 checkbox line is present');
    assert.equal(
        lines[fb1Idx + 2],
        '      0 candidates — graph blind here, read for it',
        'graph-blind item renders the exact sentinel line',
    );

    // And no item is missing from the rendered output.
    for (const item of REVIEW_REGISTRY) {
        assert.ok(
            md.includes(`- [ ] ${item.id} — `),
            `item ${item.id} not dropped`,
        );
    }
});

// ---- Case 4: every status reads NOT YET CHECKED ---------------------------

test('every checkbox line status reads NOT YET CHECKED (none pre-ticked)', () => {
    const md = renderReviewChecklist(buildChecklist());

    const checkboxes = md.split('\n').filter(l => l.startsWith('- [ ] '));
    for (const line of checkboxes) {
        assert.ok(
            line.endsWith('status: NOT YET CHECKED'),
            `checkbox line ends with the unticked default: ${line}`,
        );
    }
    // No ticked box ever appears.
    assert.ok(!md.includes('- [x]'), 'no pre-ticked box in the output');
});
