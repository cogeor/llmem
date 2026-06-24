// tests/unit/application/review/signal-interface-width.test.ts
//
// WS-4 (Loop 08) — pure-function tests for the B2 interface-width signal.
//
// `interfaceWidthScanner` is pure (ScopedSource[] in, SignalResult[] out) and
// `mergeSignals` is pure (checklist + signal map in, checklist out), so these
// tests need NO IO, NO ctx, NO scan — they hand-build sources and a checklist.
// node:test style.

import test from 'node:test';
import assert from 'node:assert/strict';

import { interfaceWidthScanner } from '../../../../src/application/review/signals/interface-width';
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

// A wide interface: 7 optional members (≥7 members → wide on count alone).
const WIDE_IFACE = `
export interface Foo {
    a?: string;
    b?: number;
    c?: boolean;
    d?: () => void;
    e?: { nested: 1 };
    f?: string[];
    g?: Map<string, number>;
}
`;

// ---- Case 1: wide interface yields FI1 + ENC5 candidates ------------------

test('interfaceWidthScanner: a 7-optional interface yields FI1 + ENC5 candidates', () => {
    const sources = [src('src/host/provider.ts', WIDE_IFACE)];

    const results = interfaceWidthScanner(sources);

    const fi1 = results.find(r => r.itemId === 'FI1');
    const enc5 = results.find(r => r.itemId === 'ENC5');
    assert.ok(fi1, 'FI1 result present');
    assert.ok(enc5, 'ENC5 result present');

    assert.equal(fi1.candidates.length, 1, 'exactly one wide-interface candidate');
    assert.equal(
        fi1.candidates[0].ref,
        'src/host/provider.ts:Foo',
        'candidate ref names the file + interface name',
    );
    assert.equal(
        fi1.candidates[0].note,
        '7 members, 7 optional',
        'candidate note reports member + optional counts',
    );

    // ENC5 carries the SAME candidates (generic ISP framing).
    assert.deepEqual(enc5.candidates, fi1.candidates, 'ENC5 mirrors FI1 candidates');
});

test('interfaceWidthScanner: a 5-member type-literal with 3 optional is wide (optional share)', () => {
    const sources = [
        src(
            'src/model.ts',
            `type Bar = {
                id: string;
                name?: string;
                age?: number;
                tag?: string;
                meta: object;
            };`,
        ),
    ];

    const fi1 = interfaceWidthScanner(sources).find(r => r.itemId === 'FI1');
    assert.ok(fi1);
    assert.equal(fi1.candidates.length, 1, 'wide via 5 members + ≥50% optional');
    assert.equal(fi1.candidates[0].ref, 'src/model.ts:Bar');
    assert.equal(fi1.candidates[0].note, '5 members, 3 optional');
});

// ---- Case 2: narrow interface yields no candidate -------------------------

test('interfaceWidthScanner: a 2-member interface yields no candidate', () => {
    const sources = [
        src('src/narrow.ts', 'interface Pair { a: number; b: number; }'),
    ];

    const results = interfaceWidthScanner(sources);
    const fi1 = results.find(r => r.itemId === 'FI1');
    const enc5 = results.find(r => r.itemId === 'ENC5');
    assert.ok(fi1);
    assert.ok(enc5);
    assert.equal(fi1.candidates.length, 0, 'narrow interface → no FI1 candidate');
    assert.equal(enc5.candidates.length, 0, 'narrow interface → no ENC5 candidate');
});

test('interfaceWidthScanner: nested member shapes do not inflate the count', () => {
    // 6 members, no optional → NOT wide (needs ≥7, or ≥5 with ≥50% optional).
    // The nested object/function bodies must NOT be counted as members.
    const sources = [
        src(
            'src/nested.ts',
            `interface Config {
                cb: () => void;
                shape: { x: number; y: number; z: number };
                handler(a: number): { ok: boolean; data: string };
                list: Array<{ id: number }>;
                name: string;
                value: number;
            }`,
        ),
    ];

    const fi1 = interfaceWidthScanner(sources).find(r => r.itemId === 'FI1');
    assert.ok(fi1);
    assert.equal(
        fi1.candidates.length,
        0,
        '6 top-level members (nested shapes not counted) → not wide',
    );
});

// ---- Case 3: merge into checklist -----------------------------------------

test('mergeSignals: wide interface fills ENC5 (graph-blind) and FI1', () => {
    const checklist = reviewRecallFromReport(
        emptyReport(),
        ig(['src/host/provider.ts'], []),
        'src/host',
        'both',
    );

    const enc5Before = entryFor(checklist, 'ENC5');
    assert.ok(enc5Before);
    assert.equal(enc5Before.graphBlind, true, 'ENC5 starts graph-blind');
    assert.equal(enc5Before.candidates.length, 0, 'ENC5 starts with no candidates');

    const signalMap = runSignalScanners(
        [src('src/host/provider.ts', WIDE_IFACE)],
        ALL_SCANNERS,
    );
    const merged = mergeSignals(checklist, signalMap);

    const enc5After = entryFor(merged, 'ENC5');
    const fi1After = entryFor(merged, 'FI1');
    assert.ok(enc5After);
    assert.ok(fi1After);
    assert.equal(enc5After.graphBlind, false, 'ENC5 no longer graph-blind');
    assert.equal(enc5After.candidates.length, 1, 'ENC5 has the wide-interface candidate');
    assert.equal(enc5After.candidates[0].ref, 'src/host/provider.ts:Foo');
    assert.equal(fi1After.candidates.length, 1, 'FI1 also carries the candidate');
    assert.equal(fi1After.candidates[0].ref, 'src/host/provider.ts:Foo');
});

// ---- Case 4: determinism --------------------------------------------------

test('interfaceWidthScanner: same sources twice → byte-identical; candidates sorted', () => {
    const sources = [
        src('z.ts', WIDE_IFACE),
        src('a.ts', 'interface Bar { p?:1; q?:2; r?:3; s?:4; t?:5; u?:6; v?:7; }'),
    ];

    const r1 = interfaceWidthScanner(sources);
    const r2 = interfaceWidthScanner(sources);
    assert.equal(JSON.stringify(r1), JSON.stringify(r2), 'scanner output byte-stable');

    const map1 = runSignalScanners(sources, ALL_SCANNERS);
    const map2 = runSignalScanners(sources, ALL_SCANNERS);
    assert.equal(
        JSON.stringify([...map1]),
        JSON.stringify([...map2]),
        'runSignalScanners output byte-stable',
    );

    // Candidates are sorted by ref (a.ts before z.ts) after the harness merge.
    const fi1 = map1.get('FI1');
    assert.ok(fi1);
    assert.deepEqual(
        fi1.map(c => c.ref),
        ['a.ts:Bar', 'z.ts:Foo'],
        'merged FI1 candidates sorted by ref',
    );
});
