// tests/unit/application/review/signal-dom-source.test.ts
//
// WS-4 (Loop 11) — pure-function tests for the A4 DOM-as-source-of-truth signal
// feeding FV1.
//
// `domSourceScanner` is pure (ScopedSource[] in, SignalResult[] out): per source,
// it emits an FV1 candidate when the file reads model facts back out of the DOM
// (querySelector(...).textContent, .getAttribute(, .dataset.<x>). These tests
// hand-build the in-scope source set and assert on the FV1 candidates.
// `mergeSignals` is pure too. No IO, no ctx, no scan. node:test style.

import test from 'node:test';
import assert from 'node:assert/strict';

import { domSourceScanner } from '../../../../src/application/review/signals/dom-source';
import {
    runSignalScanners,
    type ScopedSource,
} from '../../../../src/application/review/signals/source-scan';
import { ALL_SCANNERS } from '../../../../src/application/review/signals';
import {
    reviewRecallFromReport,
    mergeSignals,
} from '../../../../src/application/review/recall';
import type { ReviewChecklist } from '../../../../src/application/review/types';
import { ImportGraph, ImportEdge } from '../../../../src/graph/types';
import type { HealthReport } from '../../../../src/application/analysis/types';
import { zeroHealthVector } from '../../../../src/application/analysis/types';

// ---- fixtures -------------------------------------------------------------

const src = (fileId: string, text: string): ScopedSource => ({ fileId, text });

const ig = (ids: string[], edges: ImportEdge[]): ImportGraph => ({
    nodes: new Map(
        ids.map(id => [
            id,
            { id, kind: 'file', label: id, path: id, language: 'unknown' },
        ]),
    ),
    edges,
});

const emptyReport = (): HealthReport => ({
    repo: 'fixture',
    vector: zeroHealthVector(),
    importCycles: [],
    callCycles: [],
    recursion: [],
    clones: [],
    hubs: [],
    interfaceWidth: [],
});

const entryFor = (checklist: ReviewChecklist, itemId: string) =>
    checklist.entries.find(e => e.item.id === itemId);

// ---- Case 1: querySelector(...).textContent → FV1 candidate ---------------

test('domSourceScanner: querySelector(...).textContent yields an FV1 candidate', () => {
    const sources = [
        src('src/view.ts', "const t = document.querySelector('.text').textContent;"),
    ];

    const results = domSourceScanner(sources);
    const fv1 = results.find(r => r.itemId === 'FV1');
    assert.ok(fv1, 'FV1 result present');
    assert.equal(fv1.candidates.length, 1, 'exactly one DOM-reading file');
    assert.equal(fv1.candidates[0].ref, 'src/view.ts', 'candidate ref is the file id');
    assert.match(
        fv1.candidates[0].note ?? '',
        /^reads model facts from the DOM \(.*textContent.*\)$/,
        'note quotes the matched snippet',
    );
});

test('domSourceScanner: getAttribute and dataset reads also yield candidates', () => {
    const sources = [
        src('src/a.ts', 'const id = el.getAttribute("data-id");'),
        src('src/b.ts', 'const x = node.dataset.fileId;'),
    ];

    const fv1 = domSourceScanner(sources).find(r => r.itemId === 'FV1');
    assert.ok(fv1);
    assert.equal(fv1.candidates.length, 2, 'both files flagged');
    assert.deepEqual(
        fv1.candidates.map(c => c.ref),
        ['src/a.ts', 'src/b.ts'],
        'one candidate per DOM-reading file, sorted',
    );
});

// ---- Case 2: no DOM reads → no candidate ----------------------------------

test('domSourceScanner: a source with no DOM reads yields no candidate', () => {
    const sources = [
        src('src/pure.ts', 'function f(x: number): number { return x + 1; }'),
        src('src/render.ts', "el.textContent = model.name; // write, not read"),
    ];

    const fv1 = domSourceScanner(sources).find(r => r.itemId === 'FV1');
    assert.ok(fv1);
    assert.equal(fv1.candidates.length, 0, 'no DOM-as-source reads → no candidate');
});

// ---- Case 3: merge into checklist -----------------------------------------

test('mergeSignals: a DOM-reading file fills FV1 (instruction → fed)', () => {
    const checklist = reviewRecallFromReport(
        emptyReport(),
        ig(['src/a.ts', 'src/b.ts'], []),
        'src',
        'both',
    );

    const fv1Before = entryFor(checklist, 'FV1');
    assert.ok(fv1Before);
    assert.equal(fv1Before.candidates.length, 0, 'FV1 starts with no candidates');

    const signalMap = runSignalScanners(
        [
            src('src/a.ts', "const v = root.querySelectorAll('.row')[0].dataset;"),
            src('src/b.ts', 'function g(): number { return 1; }'),
        ],
        ALL_SCANNERS,
    );
    const merged = mergeSignals(checklist, signalMap);

    const fv1After = entryFor(merged, 'FV1');
    assert.ok(fv1After);
    assert.equal(fv1After.candidates.length, 1, 'FV1 has the DOM-reading candidate');
    assert.equal(fv1After.candidates[0].ref, 'src/a.ts');
});

// ---- Case 4: determinism --------------------------------------------------

test('domSourceScanner: same sources twice → byte-identical', () => {
    const sources = [
        src('z/view.ts', "const t = q.querySelector('#x').innerText;"),
        src('a/form.ts', 'const v = input.getAttribute("value");'),
        src('m/clean.ts', 'export const k = 1;'),
    ];

    const r1 = domSourceScanner(sources);
    const r2 = domSourceScanner(sources);
    assert.equal(JSON.stringify(r1), JSON.stringify(r2), 'scanner output byte-stable');

    const map1 = runSignalScanners(sources, ALL_SCANNERS);
    const map2 = runSignalScanners(sources, ALL_SCANNERS);
    assert.equal(
        JSON.stringify([...map1]),
        JSON.stringify([...map2]),
        'runSignalScanners output byte-stable',
    );
});
