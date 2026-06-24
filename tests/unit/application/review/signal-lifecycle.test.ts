// tests/unit/application/review/signal-lifecycle.test.ts
//
// WS-4 (Loop 09) — pure-function tests for the A1 listener/subscription
// balance signal.
//
// `listenerBalanceScanner` is pure (ScopedSource[] in, SignalResult[] out) and
// `mergeSignals` is pure (checklist + signal map in, checklist out), so these
// tests need NO IO, NO ctx, NO scan — they hand-build sources and a checklist.
// node:test style.

import test from 'node:test';
import assert from 'node:assert/strict';

import { listenerBalanceScanner } from '../../../../src/application/review/signals/lifecycle';
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

// 5 registers, 0 releases.
const LEAKY = `
el.addEventListener('click', h);
el.addEventListener('keydown', h);
store.subscribe(fn);
emitter.on('data', fn);
ro.observe(node);
`;

// 3 register / 3 release — balanced.
const BALANCED = `
el.addEventListener('click', h);
store.subscribe(fn);
sock.connect();
el.removeEventListener('click', h);
store.unsubscribe(fn);
sock.disconnect();
`;

// ---- Case 1: leaky file (5 register / 0 release) yields FL1 + ST4 ----------

test('listenerBalanceScanner: 5 register / 0 release yields FL1 + ST4 candidate noting 5 vs 0', () => {
    const sources = [src('src/webview/panel.ts', LEAKY)];

    const results = listenerBalanceScanner(sources);

    const fl1 = results.find(r => r.itemId === 'FL1');
    const st4 = results.find(r => r.itemId === 'ST4');
    assert.ok(fl1, 'FL1 result present');
    assert.ok(st4, 'ST4 result present');

    assert.equal(fl1.candidates.length, 1, 'exactly one unbalanced-file candidate');
    assert.equal(
        fl1.candidates[0].ref,
        'src/webview/panel.ts',
        'candidate ref is the file id',
    );
    assert.equal(
        fl1.candidates[0].note,
        '5 register vs 0 release call(s) — possible leak',
        'candidate note reports 5 register vs 0 release',
    );

    // ST4 carries the SAME candidates (generic lifecycle framing).
    assert.deepEqual(st4.candidates, fl1.candidates, 'ST4 mirrors FL1 candidates');
});

// ---- Case 2: balanced file yields no candidate ----------------------------

test('listenerBalanceScanner: a balanced (3/3) file yields no candidate', () => {
    const sources = [src('src/balanced.ts', BALANCED)];

    const results = listenerBalanceScanner(sources);
    const fl1 = results.find(r => r.itemId === 'FL1');
    const st4 = results.find(r => r.itemId === 'ST4');
    assert.ok(fl1);
    assert.ok(st4);
    assert.equal(fl1.candidates.length, 0, 'balanced file → no FL1 candidate');
    assert.equal(st4.candidates.length, 0, 'balanced file → no ST4 candidate');
});

test('listenerBalanceScanner: word boundaries — `connection(` does not match `connect`', () => {
    // One real register (`addEventListener`); `connection(`/`disconnection(`
    // must NOT count as connect/disconnect, so this stays balanced-or-clean
    // (1 register, 0 release → still a candidate noting 1 vs 0, but the false
    // method-name lexemes must not inflate either side).
    const sources = [
        src(
            'src/net.ts',
            `el.addEventListener('x', h);
             const c = connection(host);
             const d = disconnection(host);
             watchman(opts);`,
        ),
    ];

    const fl1 = listenerBalanceScanner(sources).find(r => r.itemId === 'FL1');
    assert.ok(fl1);
    assert.equal(fl1.candidates.length, 1, 'only the addEventListener counts as register');
    assert.equal(
        fl1.candidates[0].note,
        '1 register vs 0 release call(s) — possible leak',
        'connection/disconnection/watchman not counted',
    );
});

// ---- Case 3: merge into checklist -----------------------------------------

test('mergeSignals: leaky file fills FL1 (graph-blind) and ST4', () => {
    const checklist = reviewRecallFromReport(
        emptyReport(),
        ig(['src/webview/panel.ts'], []),
        'src/webview',
        'both',
    );

    const fl1Before = entryFor(checklist, 'FL1');
    assert.ok(fl1Before);
    assert.equal(fl1Before.graphBlind, true, 'FL1 starts graph-blind');
    assert.equal(fl1Before.candidates.length, 0, 'FL1 starts with no candidates');

    const signalMap = runSignalScanners(
        [src('src/webview/panel.ts', LEAKY)],
        ALL_SCANNERS,
    );
    const merged = mergeSignals(checklist, signalMap);

    const fl1After = entryFor(merged, 'FL1');
    const st4After = entryFor(merged, 'ST4');
    assert.ok(fl1After);
    assert.ok(st4After);
    assert.equal(fl1After.graphBlind, false, 'FL1 no longer graph-blind');
    assert.equal(fl1After.candidates.length, 1, 'FL1 has the leak candidate');
    assert.equal(fl1After.candidates[0].ref, 'src/webview/panel.ts');
    assert.equal(st4After.candidates.length, 1, 'ST4 also carries the candidate');
    assert.equal(st4After.candidates[0].ref, 'src/webview/panel.ts');
});

// ---- Case 4: determinism --------------------------------------------------

test('listenerBalanceScanner: same sources twice → byte-identical; candidates sorted', () => {
    const sources = [
        src('z.ts', LEAKY),
        src('a.ts', 'foo.addEventListener("x", h); foo.subscribe(g);'),
    ];

    const r1 = listenerBalanceScanner(sources);
    const r2 = listenerBalanceScanner(sources);
    assert.equal(JSON.stringify(r1), JSON.stringify(r2), 'scanner output byte-stable');

    const map1 = runSignalScanners(sources, ALL_SCANNERS);
    const map2 = runSignalScanners(sources, ALL_SCANNERS);
    assert.equal(
        JSON.stringify([...map1]),
        JSON.stringify([...map2]),
        'runSignalScanners output byte-stable',
    );

    // Candidates are sorted by ref (a.ts before z.ts) after the harness merge.
    const fl1 = map1.get('FL1');
    assert.ok(fl1);
    assert.deepEqual(
        fl1.map(c => c.ref),
        ['a.ts', 'z.ts'],
        'merged FL1 candidates sorted by ref',
    );
});
