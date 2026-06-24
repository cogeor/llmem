// tests/unit/application/review/signal-transport.test.ts
//
// WS-4 (Loop 12) — pure-function tests for the B1 transport-boundary typing
// signal feeding FP1.
//
// `transportScanner` is pure (ScopedSource[] in, SignalResult[] out): per source,
// it emits an FP1 candidate when the file contains a message/event transport sink
// (onDidReceiveMessage(, addEventListener('message', .onmessage, postMessage(),
// noting two typing flags (payloadUntyped, validatesBeforeUse). These tests
// hand-build the in-scope source set and assert on the FP1 candidates.
// `mergeSignals` is pure too. No IO, no ctx, no scan. node:test style.

import test from 'node:test';
import assert from 'node:assert/strict';

import { transportScanner } from '../../../../src/application/review/signals/transport';
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

// ---- Case 1: untyped sink, no validator → FP1 candidate -------------------

test('transportScanner: onDidReceiveMessage((message: any)) with no validator yields an FP1 candidate', () => {
    const sources = [
        src(
            'src/panel.ts',
            'panel.webview.onDidReceiveMessage((message: any) => { dispatch(message); });',
        ),
    ];

    const results = transportScanner(sources);
    const fp1 = results.find(r => r.itemId === 'FP1');
    assert.ok(fp1, 'FP1 result present');
    assert.equal(fp1.candidates.length, 1, 'exactly one transport-sink file');
    assert.equal(fp1.candidates[0].ref, 'src/panel.ts', 'candidate ref is the file id');
    assert.equal(
        fp1.candidates[0].note,
        'transport sink; payloadUntyped=true validatesBeforeUse=false',
        'note records the typing flags',
    );
});

test('transportScanner: a sink inside a class method names <fileId>::Host.wire', () => {
    const sources = [
        src(
            'src/panel.ts',
            `class Host {
    wire() {
        panel.webview.onDidReceiveMessage((m: any) => dispatch(m));
    }
}`,
        ),
    ];

    const fp1 = transportScanner(sources).find(r => r.itemId === 'FP1');
    assert.ok(fp1);
    assert.equal(fp1.candidates.length, 1, 'one transport-sink candidate');
    assert.equal(
        fp1.candidates[0].ref,
        'src/panel.ts::Host.wire',
        'ref names the entity enclosing the first sink',
    );
    assert.equal(
        fp1.candidates[0].note,
        'transport sink; payloadUntyped=true validatesBeforeUse=false',
        'typing-flag note unchanged',
    );
});

test('transportScanner: a top-level sink falls back to the plain file id', () => {
    const sources = [
        src(
            'src/win.ts',
            'window.addEventListener("message", ev => { dispatch(ev.data); });',
        ),
    ];

    const fp1 = transportScanner(sources).find(r => r.itemId === 'FP1');
    assert.ok(fp1);
    assert.equal(fp1.candidates.length, 1);
    assert.equal(
        fp1.candidates[0].ref,
        'src/win.ts',
        'top-level sink → plain file id (fallback)',
    );
});

test('transportScanner: other sink shapes also yield candidates with flags', () => {
    const sources = [
        src(
            'src/a.ts',
            'window.addEventListener("message", ev => { state.parse(ev.data); });',
        ),
        src('src/b.ts', 'ws.onmessage = (e) => { handle(e.data); };'),
        src('src/c.ts', 'worker.postMessage(payload);'),
    ];

    const fp1 = transportScanner(sources).find(r => r.itemId === 'FP1');
    assert.ok(fp1);
    assert.deepEqual(
        fp1.candidates.map(c => c.ref),
        ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        'one candidate per transport-sink file, sorted',
    );
    // a.ts validates (parse(), no untyped annotation):
    assert.equal(
        fp1.candidates[0].note,
        'transport sink; payloadUntyped=false validatesBeforeUse=true',
    );
});

// ---- Case 2: no transport sink → no candidate -----------------------------

test('transportScanner: a source with no transport sink yields no candidate', () => {
    const sources = [
        src('src/pure.ts', 'function f(x: number): number { return x + 1; }'),
        src('src/typed.ts', 'const msg: unknown = readConfig(); // any/unknown but no sink'),
    ];

    const fp1 = transportScanner(sources).find(r => r.itemId === 'FP1');
    assert.ok(fp1);
    assert.equal(fp1.candidates.length, 0, 'no transport sink → no candidate');
});

// ---- Case 3: merge into checklist -----------------------------------------

test('mergeSignals: a transport-sink file fills FP1 (instruction → fed)', () => {
    const checklist = reviewRecallFromReport(
        emptyReport(),
        ig(['src/a.ts', 'src/b.ts'], []),
        'src',
        'both',
    );

    const fp1Before = entryFor(checklist, 'FP1');
    assert.ok(fp1Before);
    assert.equal(fp1Before.candidates.length, 0, 'FP1 starts with no candidates');

    const signalMap = runSignalScanners(
        [
            src('src/a.ts', 'host.onDidReceiveMessage((m: unknown) => route(m));'),
            src('src/b.ts', 'function g(): number { return 1; }'),
        ],
        ALL_SCANNERS,
    );
    const merged = mergeSignals(checklist, signalMap);

    const fp1After = entryFor(merged, 'FP1');
    assert.ok(fp1After);
    assert.equal(fp1After.candidates.length, 1, 'FP1 has the transport-sink candidate');
    assert.equal(fp1After.candidates[0].ref, 'src/a.ts');
});

// ---- Case 4: determinism --------------------------------------------------

test('transportScanner: same sources twice → byte-identical', () => {
    const sources = [
        src('z/panel.ts', 'view.onDidReceiveMessage((m: any) => f(m));'),
        src('a/ws.ts', 'socket.onmessage = e => decode(e.data);'),
        src('m/clean.ts', 'export const k = 1;'),
    ];

    const r1 = transportScanner(sources);
    const r2 = transportScanner(sources);
    assert.equal(JSON.stringify(r1), JSON.stringify(r2), 'scanner output byte-stable');

    const map1 = runSignalScanners(sources, ALL_SCANNERS);
    const map2 = runSignalScanners(sources, ALL_SCANNERS);
    assert.equal(
        JSON.stringify([...map1]),
        JSON.stringify([...map2]),
        'runSignalScanners output byte-stable',
    );
});
