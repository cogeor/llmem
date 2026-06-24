// tests/unit/application/review/signal-ambient.test.ts
//
// WS-4 (Loop 07) — pure-function tests for the A2 ambient-global signal and the
// shared signal harness's `mergeSignals` fold.
//
// `ambientScanner` is pure (ScopedSource[] in, SignalResult[] out) and
// `mergeSignals` is pure (checklist + signal map in, checklist out), so these
// tests need NO IO, NO ctx, NO scan — they hand-build sources and a checklist.
// node:test style.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ambientScanner } from '../../../../src/application/review/signals/ambient';
import {
    runSignalScanners,
    type ScopedSource,
} from '../../../../src/application/review/signals/source-scan';
import { ALL_SCANNERS } from '../../../../src/application/review/signals';
import {
    reviewRecallFromReport,
    mergeSignals,
} from '../../../../src/application/review/recall';
import type {
    ReviewChecklist,
    RecallCandidate,
} from '../../../../src/application/review/types';
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

// ---- Case 1: injected global yields a candidate; platform global does not --

test('ambientScanner: window.GRAPH_DATA yields an FB1 candidate; window.location yields none', () => {
    const sources = [
        src('src/webview/data.ts', 'const g = window.GRAPH_DATA;\nconst l = window.location.href;'),
    ];

    const results = ambientScanner(sources);

    const fb1 = results.find(r => r.itemId === 'FB1');
    assert.ok(fb1, 'FB1 result present');
    assert.equal(fb1.candidates.length, 1, 'exactly one injected-global candidate');
    assert.equal(
        fb1.candidates[0].ref,
        'src/webview/data.ts:window.GRAPH_DATA',
        'candidate ref names the file + injected global',
    );
    assert.equal(
        fb1.candidates[0].note,
        'reads injected global window.GRAPH_DATA',
        'candidate note describes the injected read',
    );

    // window.location is a platform global — NOT on the injected allow-list —
    // so it produces no candidate.
    assert.ok(
        !fb1.candidates.some(c => c.ref.includes('location')),
        'platform global window.location is not a candidate',
    );

    // DEP3 carries the SAME candidates (generic boundary-bypass framing).
    const dep3 = results.find(r => r.itemId === 'DEP3');
    assert.ok(dep3, 'DEP3 result present');
    assert.deepEqual(dep3.candidates, fb1.candidates, 'DEP3 mirrors FB1 candidates');
});

test('ambientScanner: globalThis.WORK_TREE matches; one candidate per (file, global) pair', () => {
    const sources = [
        // Two reads of the same injected global in one file → ONE candidate.
        src('a.ts', 'globalThis.WORK_TREE; if (globalThis.WORK_TREE) {}'),
        // A second file reads a different injected global.
        src('b.ts', 'window.DESIGN_DOCS'),
        // A non-injected global → nothing.
        src('c.ts', 'window.requestAnimationFrame(() => {});'),
    ];

    const fb1 = ambientScanner(sources).find(r => r.itemId === 'FB1');
    assert.ok(fb1);
    const refs = fb1.candidates.map(c => c.ref).sort((x, y) => x.localeCompare(y));
    assert.deepEqual(
        refs,
        ['a.ts:window.WORK_TREE', 'b.ts:window.DESIGN_DOCS'],
        'one candidate per (file, injected-global); the platform global is dropped',
    );
});

// ---- Case 2: mergeSignals (pure) ------------------------------------------

test('mergeSignals: FB1 graphBlind→false with the signal candidate; other entries untouched', () => {
    // A pure checklist where FB1 starts graph-blind with zero candidates.
    const checklist = reviewRecallFromReport(
        emptyReport(),
        ig(['src/webview/data.ts'], []),
        'src/webview',
        'both',
    );

    const fb1Before = entryFor(checklist, 'FB1');
    assert.ok(fb1Before);
    assert.equal(fb1Before.graphBlind, true, 'FB1 starts graph-blind');
    assert.equal(fb1Before.candidates.length, 0, 'FB1 starts with no candidates');

    const candidate: RecallCandidate = {
        ref: 'src/webview/data.ts:window.GRAPH_DATA',
        note: 'reads injected global window.GRAPH_DATA',
    };
    const signalMap = new Map<string, RecallCandidate[]>([['FB1', [candidate]]]);

    const merged = mergeSignals(checklist, signalMap);

    const fb1After = entryFor(merged, 'FB1');
    assert.ok(fb1After);
    assert.equal(fb1After.graphBlind, false, 'FB1 is no longer graph-blind');
    assert.equal(fb1After.candidates.length, 1, 'FB1 has the signal candidate');
    assert.deepEqual(fb1After.candidates[0], candidate, 'the exact signal candidate is attached');

    // No other entry changed — same graphBlind + candidate count as before.
    for (const before of checklist.entries) {
        if (before.item.id === 'FB1') {
            continue;
        }
        const after = entryFor(merged, before.item.id);
        assert.ok(after);
        assert.equal(after.graphBlind, before.graphBlind, `${before.item.id} graphBlind unchanged`);
        assert.equal(
            after.candidates.length,
            before.candidates.length,
            `${before.item.id} candidate count unchanged`,
        );
    }
});

test('mergeSignals: appends (does not replace) existing candidates', () => {
    const checklist: ReviewChecklist = {
        path: 'src',
        scope: 'folder',
        ruleset: 'both',
        entries: [
            {
                item: {
                    id: 'FI1',
                    category: 'x',
                    ruleset: 'frontend',
                    scope: 'file',
                    recallStrength: '●●●',
                    title: 'God-facade provider',
                    recallQuery: 'interface-width',
                    promptInstruction: 'x',
                },
                candidates: [{ ref: 'analyzer:hit', note: 'from analyzer' }],
                status: 'not-yet-checked',
                graphBlind: false,
            },
        ],
    };

    const signalMap = new Map<string, RecallCandidate[]>([
        ['FI1', [{ ref: 'signal:hit', note: 'from signal' }]],
    ]);

    const merged = mergeSignals(checklist, signalMap);
    const fi1 = entryFor(merged, 'FI1');
    assert.ok(fi1);
    assert.equal(fi1.candidates.length, 2, 'analyzer + signal candidates both present');
    assert.deepEqual(
        fi1.candidates.map(c => c.ref),
        ['analyzer:hit', 'signal:hit'],
        'both candidates retained, sorted by ref',
    );
});

// ---- Case 3: determinism --------------------------------------------------

test('scanning the same sources twice → identical results; merged checklist byte-identical', () => {
    const sources = [
        src('z.ts', 'window.FOLDER_TREE; window.GRAPH_DATA;'),
        src('a.ts', 'globalThis.LLMEM_DEBUG'),
    ];

    const r1 = ambientScanner(sources);
    const r2 = ambientScanner(sources);
    assert.equal(JSON.stringify(r1), JSON.stringify(r2), 'scanner output byte-stable');

    const map1 = runSignalScanners(sources, ALL_SCANNERS);
    const map2 = runSignalScanners(sources, ALL_SCANNERS);
    assert.equal(
        JSON.stringify([...map1]),
        JSON.stringify([...map2]),
        'runSignalScanners output byte-stable',
    );

    const checklist = reviewRecallFromReport(
        emptyReport(),
        ig(['z.ts', 'a.ts'], []),
        'src',
        'both',
    );
    const merged1 = mergeSignals(checklist, runSignalScanners(sources, ALL_SCANNERS));
    const merged2 = mergeSignals(checklist, runSignalScanners(sources, ALL_SCANNERS));
    assert.equal(
        JSON.stringify(merged1),
        JSON.stringify(merged2),
        'merged checklist byte-identical across runs',
    );
});
