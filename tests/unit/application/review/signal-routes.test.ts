// tests/unit/application/review/signal-routes.test.ts
//
// WS-4 (Loop 13) — pure-function tests for the B3 route-literal reachability
// signal feeding FD2.
//
// `routeLiteralScanner` is pure (ScopedSource[] in, SignalResult[] out) and
// aggregates ACROSS the whole sources array (the union decl may live in one
// file, its register* calls in another), so these tests hand-build the in-scope
// source set and assert on the FD2 candidates. `mergeSignals` is pure too. No
// IO, no ctx, no scan. node:test style.

import test from 'node:test';
import assert from 'node:assert/strict';

import { routeLiteralScanner } from '../../../../src/application/review/signals/routes';
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

const DORMANT_NOTE =
    'route/view literal with no register* call — possibly dormant';

// ---- Case 1: partially-registered union, decl & registrations cross files --

test('routeLiteralScanner: union members with no register* call become FD2 candidates (cross-file)', () => {
    const sources = [
        src(
            'src/types.ts',
            "export type View = 'graph' | 'folders' | 'design' | 'packages';",
        ),
        src(
            'src/router.ts',
            "registerRoute('graph');\nregisterRoute('folders');",
        ),
    ];

    const fd2 = routeLiteralScanner(sources).find(r => r.itemId === 'FD2');
    assert.ok(fd2, 'FD2 result present');
    assert.deepEqual(
        fd2.candidates.map(c => c.ref),
        ['design', 'packages'],
        'unregistered members surface, sorted; registered ones are dropped',
    );
    assert.equal(fd2.candidates[0].note, DORMANT_NOTE, 'fixed dormant note');
});

// ---- Case 2: a fully-registered union yields no candidate -----------------

test('routeLiteralScanner: a fully-registered union yields no candidate', () => {
    const sources = [
        src('src/types.ts', "type RouteMode = 'a' | 'b' | 'c';"),
        src(
            'src/wire.ts',
            "registerView('a'); registerView('b'); registerRoute('c');",
        ),
    ];

    const fd2 = routeLiteralScanner(sources).find(r => r.itemId === 'FD2');
    assert.ok(fd2);
    assert.equal(fd2.candidates.length, 0, 'every member registered → none');
});

// ---- Case 3: tolerant WIDTH form — ≥3-literal union on a Route-named alias -

test('routeLiteralScanner: a wide string union on a Route-named alias is recognized', () => {
    const sources = [
        src('src/r.ts', "type AppRoute = 'home' | 'about' | 'contact';"),
        src('src/reg.ts', "registerRoute('home');"),
    ];

    const fd2 = routeLiteralScanner(sources).find(r => r.itemId === 'FD2');
    assert.ok(fd2);
    assert.deepEqual(
        fd2.candidates.map(c => c.ref),
        ['about', 'contact'],
        'unregistered members of the wide Route union surface',
    );
});

// ---- Case 4: merge into checklist (FD2 graph-blind → fed) ------------------

test('mergeSignals: unregistered route literals fill FD2', () => {
    const checklist = reviewRecallFromReport(
        emptyReport(),
        ig(['src/a.ts', 'src/b.ts'], []),
        'src',
        'both',
    );

    const fd2Before = entryFor(checklist, 'FD2');
    assert.ok(fd2Before);
    assert.equal(fd2Before.candidates.length, 0, 'FD2 starts with no candidates');

    const signalMap = runSignalScanners(
        [
            src('src/a.ts', "type View = 'graph' | 'folders' | 'design';"),
            src('src/b.ts', "registerRoute('graph');"),
        ],
        ALL_SCANNERS,
    );
    const merged = mergeSignals(checklist, signalMap);

    const fd2After = entryFor(merged, 'FD2');
    assert.ok(fd2After);
    assert.deepEqual(
        fd2After.candidates.map(c => c.ref),
        ['design', 'folders'],
        'FD2 carries the unregistered route literals, sorted',
    );
});

// ---- Case 5: determinism --------------------------------------------------

test('routeLiteralScanner: same sources twice → byte-identical; candidates sorted', () => {
    const sources = [
        src('src/wire.ts', "registerView('two');"),
        src('src/types.ts', "type PageView = 'zeta' | 'alpha' | 'two';"),
    ];

    const r1 = routeLiteralScanner(sources);
    const r2 = routeLiteralScanner(sources);
    assert.equal(JSON.stringify(r1), JSON.stringify(r2), 'scanner output byte-stable');

    const map1 = runSignalScanners(sources, ALL_SCANNERS);
    const map2 = runSignalScanners(sources, ALL_SCANNERS);
    assert.equal(
        JSON.stringify([...map1]),
        JSON.stringify([...map2]),
        'runSignalScanners output byte-stable',
    );

    // sortDedupeCandidates (via runSignalScanners) sorts by ref; the raw scanner
    // output here is verified sorted after the merge.
    const fd2 = map1.get('FD2');
    assert.ok(fd2);
    assert.deepEqual(
        fd2.map(c => c.ref),
        ['alpha', 'zeta'],
        'candidates sorted regardless of source/member order',
    );
});
