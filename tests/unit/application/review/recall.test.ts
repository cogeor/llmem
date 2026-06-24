// tests/unit/application/review/recall.test.ts
//
// WS-2 — pure-function tests for the review recall pass.
//
// Exercises the PURE `reviewRecallFromReport(report, importGraph, path, ruleset)`
// directly with hand-built HealthReport + ImportGraph fixtures (no IO, no scan),
// mirroring the `ig` import-graph helper from the interface-width analyzer test.
// node:test style.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ImportGraph, ImportEdge } from '../../../../src/graph/types';
import type {
    HealthReport,
    CycleFinding,
} from '../../../../src/application/analysis/types';
import { zeroHealthVector } from '../../../../src/application/analysis/types';
import { reviewRecallFromReport } from '../../../../src/application/review/recall';
import { REVIEW_REGISTRY } from '../../../../src/application/review/registry';

// ---- fixture helpers (ig from interface-width.test.ts) --------------------

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

// A two-node import cycle finding over the given member files.
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

// Empty report scaffold with the zero vector; tests fill in finding arrays.
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

const entryFor = (
    checklist: ReturnType<typeof reviewRecallFromReport>,
    itemId: string,
) => checklist.entries.find(e => e.item.id === itemId);

// import graph: two folders, src/webview/* and src/graph/*.
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

// ---- Case 1: a built item attaches real candidates for an in-subtree cycle -

test('DEP1 (cycles) attaches a real candidate for an in-subtree import cycle', () => {
    const report = emptyReport({
        importCycles: [cycle('cyc:webview', 'src/webview/a.ts', 'src/webview/b.ts')],
    });

    const checklist = reviewRecallFromReport(
        report,
        fixtureGraph(),
        'src/webview',
        'general',
    );

    const dep1 = entryFor(checklist, 'DEP1');
    assert.ok(dep1, 'DEP1 entry present');
    assert.equal(dep1.graphBlind, false, 'DEP1 is NOT graph-blind (has a candidate)');
    assert.equal(dep1.candidates.length, 1, 'one cycle candidate attached');
    assert.equal(dep1.candidates[0].ref, 'cyc:webview', 'candidate ref is the finding id');
    assert.equal(dep1.candidates[0].note, 'import cycle src/webview/a.ts ⇄ src/webview/b.ts');
});

// ---- Case 2: an instruction item is graph-blind with empty candidates ------

test('FB1 (instruction) is graph-blind with no candidates', () => {
    const report = emptyReport({
        importCycles: [cycle('cyc:webview', 'src/webview/a.ts', 'src/webview/b.ts')],
    });

    const checklist = reviewRecallFromReport(
        report,
        fixtureGraph(),
        'src/webview',
        'both',
    );

    const fb1 = entryFor(checklist, 'FB1');
    assert.ok(fb1, 'FB1 entry present');
    assert.equal(fb1.item.recallQuery, 'instruction', 'FB1 is instruction-as-recall');
    assert.equal(fb1.graphBlind, true, 'instruction item is graph-blind');
    assert.equal(fb1.candidates.length, 0, 'instruction item has no candidates');
});

// ---- Case 3: a finding OUTSIDE the review path does NOT attach -------------

test('a cycle outside the reviewed subtree does not attach (subtree filter)', () => {
    // The cycle is in src/webview; review src/graph — must not surface.
    const report = emptyReport({
        importCycles: [cycle('cyc:webview', 'src/webview/a.ts', 'src/webview/b.ts')],
    });

    const checklist = reviewRecallFromReport(
        report,
        fixtureGraph(),
        'src/graph',
        'general',
    );

    const dep1 = entryFor(checklist, 'DEP1');
    assert.ok(dep1, 'DEP1 entry present');
    assert.equal(dep1.candidates.length, 0, 'out-of-subtree cycle did not attach');
    assert.equal(dep1.graphBlind, true, '0 candidates ⇒ graph-blind (read for it, not clean)');
});

// ---- Case 4: ruleset selection counts -------------------------------------

test('ruleset selection: general / frontend / both entry counts', () => {
    const report = emptyReport();
    const graph = fixtureGraph();

    const general = reviewRecallFromReport(report, graph, 'src', 'general');
    const frontend = reviewRecallFromReport(report, graph, 'src', 'frontend');
    const both = reviewRecallFromReport(report, graph, 'src', 'both');

    const generalCount = REVIEW_REGISTRY.filter(i => i.ruleset === 'general').length;
    const frontendCount = REVIEW_REGISTRY.filter(i => i.ruleset === 'frontend').length;

    assert.equal(general.entries.length, generalCount, 'general entries = general items');
    assert.equal(frontend.entries.length, frontendCount, 'frontend entries = frontend items');
    assert.equal(both.entries.length, REVIEW_REGISTRY.length, 'both = all 65 items');
    assert.equal(both.entries.length, 65, 'all-rulesets checklist has 65 entries');

    assert.ok(
        general.entries.every(e => e.item.ruleset === 'general'),
        'general checklist holds only general items',
    );
    assert.ok(
        frontend.entries.every(e => e.item.ruleset === 'frontend'),
        'frontend checklist holds only frontend items',
    );
});

// ---- Case 5: entry order follows REVIEW_REGISTRY; determinism --------------

test('entries follow registry order and two runs are byte-identical', () => {
    const report = emptyReport({
        importCycles: [cycle('cyc:webview', 'src/webview/a.ts', 'src/webview/b.ts')],
        clones: [],
    });

    const run1 = reviewRecallFromReport(report, fixtureGraph(), 'src/webview', 'both');
    const run2 = reviewRecallFromReport(report, fixtureGraph(), 'src/webview', 'both');

    assert.equal(
        JSON.stringify(run1),
        JSON.stringify(run2),
        'JSON.stringify byte-stable across runs',
    );

    const registryOrder = REVIEW_REGISTRY.map(i => i.id);
    const entryOrder = run1.entries.map(e => e.item.id);
    assert.deepEqual(entryOrder, registryOrder, 'entries follow REVIEW_REGISTRY order');
});
