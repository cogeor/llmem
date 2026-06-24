// tests/unit/application/review/signal-payload-owners.test.ts
//
// WS-4 (Loop 10) — pure-function tests for the A3 resource-payload ownership
// signal feeding FR1.
//
// `payloadOwnerScanner` is pure (ScopedSource[] in, SignalResult[] out) and
// aggregates ACROSS the whole sources array (cross-file ownership), so these
// tests hand-build the in-scope source set and assert on the FR1 candidates.
// `mergeSignals` is pure too. No IO, no ctx, no scan. node:test style.

import test from 'node:test';
import assert from 'node:assert/strict';

import { payloadOwnerScanner } from '../../../../src/application/review/signals/payload-owners';
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

// ---- Case 1: three files each holding a `: GraphData` field → FR1 candidate -

test('payloadOwnerScanner: three GraphData owners yield an FR1 candidate listing all three', () => {
    const sources = [
        src('src/c/panel.ts', 'class Panel { private graph: GraphData; }'),
        src('src/a/store.ts', 'class Store { readonly data: GraphData = init(); }'),
        src('src/b/view.ts', 'let current: GraphData;'),
    ];

    const results = payloadOwnerScanner(sources);
    const fr1 = results.find(r => r.itemId === 'FR1');
    assert.ok(fr1, 'FR1 result present');
    assert.equal(fr1.candidates.length, 1, 'exactly one multi-owned DTO');
    assert.equal(fr1.candidates[0].ref, 'GraphData', 'candidate ref is the DTO name');
    assert.equal(
        fr1.candidates[0].note,
        'held by 3 modules: src/a/store.ts, src/b/view.ts, src/c/panel.ts',
        'note lists all three owners, sorted by file id',
    );
});

// ---- Case 2: a single-owner DTO yields no candidate -----------------------

test('payloadOwnerScanner: a DTO held by only one file yields no candidate', () => {
    const sources = [
        src('src/only.ts', 'class X { tree: FolderTreeData; }'),
        src('src/other.ts', 'function f(): number { return 1; }'),
    ];

    const fr1 = payloadOwnerScanner(sources).find(r => r.itemId === 'FR1');
    assert.ok(fr1);
    assert.equal(fr1.candidates.length, 0, 'single-owner DTO → no candidate');
});

test('payloadOwnerScanner: word-boundaried — `GraphDataView` does not match `GraphData`', () => {
    const sources = [
        src('src/x.ts', 'class X { v: GraphDataView; }'),
        src('src/y.ts', 'class Y { w: GraphDataView; }'),
    ];
    const fr1 = payloadOwnerScanner(sources).find(r => r.itemId === 'FR1');
    assert.ok(fr1);
    assert.equal(fr1.candidates.length, 0, 'GraphDataView is not a payload DTO');
});

// ---- Case 3: merge into checklist -----------------------------------------

test('mergeSignals: multi-owned GraphData fills FR1 (graph-blind → fed)', () => {
    const checklist = reviewRecallFromReport(
        emptyReport(),
        ig(['src/a.ts', 'src/b.ts'], []),
        'src',
        'both',
    );

    const fr1Before = entryFor(checklist, 'FR1');
    assert.ok(fr1Before);
    assert.equal(fr1Before.candidates.length, 0, 'FR1 starts with no candidates');

    const signalMap = runSignalScanners(
        [
            src('src/a.ts', 'class A { g: GraphData; }'),
            src('src/b.ts', 'class B { g: GraphData; }'),
        ],
        ALL_SCANNERS,
    );
    const merged = mergeSignals(checklist, signalMap);

    const fr1After = entryFor(merged, 'FR1');
    assert.ok(fr1After);
    assert.equal(fr1After.candidates.length, 1, 'FR1 has the multi-owned candidate');
    assert.equal(fr1After.candidates[0].ref, 'GraphData');
});

// ---- Case 4: determinism --------------------------------------------------

test('payloadOwnerScanner: same sources twice → byte-identical; owner list sorted', () => {
    const sources = [
        src('z/panel.ts', 'class P { d: WorkTreeData; }'),
        src('a/store.ts', 'class S { d: WorkTreeData; }'),
        src('m/view.ts', 'let d: WorkTreeData;'),
    ];

    const r1 = payloadOwnerScanner(sources);
    const r2 = payloadOwnerScanner(sources);
    assert.equal(JSON.stringify(r1), JSON.stringify(r2), 'scanner output byte-stable');

    const fr1 = r1.find(r => r.itemId === 'FR1');
    assert.ok(fr1);
    assert.equal(
        fr1.candidates[0].note,
        'held by 3 modules: a/store.ts, m/view.ts, z/panel.ts',
        'owner list sorted regardless of source order',
    );

    const map1 = runSignalScanners(sources, ALL_SCANNERS);
    const map2 = runSignalScanners(sources, ALL_SCANNERS);
    assert.equal(
        JSON.stringify([...map1]),
        JSON.stringify([...map2]),
        'runSignalScanners output byte-stable',
    );
});
