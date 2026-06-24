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
    CloneFinding,
    InterfaceWidthFinding,
    Severity,
} from '../../../../src/application/analysis/types';
import { zeroHealthVector } from '../../../../src/application/analysis/types';
import { reviewRecallFromReport } from '../../../../src/application/review/recall';
import { REVIEW_REGISTRY } from '../../../../src/application/review/registry';

// fileId-from-entityId, mirroring recall.ts `toFileId` (strip `::name`).
const fileIdOf = (id: string): string => {
    const idx = id.indexOf('::');
    return idx === -1 ? id : id.slice(0, idx);
};

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

// An interface-width finding over `module`, with all numeric fields filled.
const widthFinding = (
    module: string,
    severity: Severity,
    scope: 'file' | 'folder' | 'function' = 'file',
    wEff = 4,
): InterfaceWidthFinding => ({
    id: `width:${module}`,
    type: 'interface-width',
    severity,
    title: `interface width ${module}`,
    detail: `${module} surface`,
    relatedFiles: [fileIdOf(module)],
    module,
    scope,
    treeDepth: 1,
    w: 4,
    wEff,
    moduleDepth: 10,
    dmr: 10 / wEff,
    topEntryPoints: [],
});

// A clone-cluster finding over the given entity-id members.
const cloneFinding = (
    members: string[],
    severity: Severity = 'medium',
): CloneFinding => ({
    id: `clone:${members.join('|')}`,
    type: 'clone',
    severity,
    title: `clone ${members.join(', ')}`,
    detail: `${members.length}-member clone cluster`,
    relatedFiles: [...new Set(members.map(fileIdOf))],
    cloneType: 'exact-body',
    similarity: 1,
    members: [...members].sort((x, y) => x.localeCompare(y)),
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
    // FB1's recallQuery is now 'ambient' (WS-4, Loop 07). The PURE
    // reviewRecallFromReport runs NO signal scanners — 'ambient' is not a
    // BUILT_QUERIES analyzer key — so the pure core still leaves FB1 graph-blind
    // with zero candidates. The ambient candidates are folded in only by the
    // `runReviewRecall` wrapper via `mergeSignals` (see signal-ambient.test.ts).
    assert.equal(fb1.item.recallQuery, 'ambient', 'FB1 recallQuery is the ambient signal');
    assert.equal(fb1.graphBlind, true, 'pure core leaves FB1 graph-blind (no signal pass)');
    assert.equal(fb1.candidates.length, 0, 'pure core attaches no candidates to FB1');
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

// ---- Case 6: FI1 width gate drops low severity, keeps high/medium ---------

test('FI1 gate keeps high/medium width findings, drops low-severity', () => {
    const report = emptyReport({
        interfaceWidth: [
            widthFinding('src/webview/a.ts', 'low'),
            widthFinding('src/webview/b.ts', 'medium'),
            widthFinding('src/webview/c.ts', 'high'),
            widthFinding('src/webview/d.ts', 'low'),
        ],
    });

    const checklist = reviewRecallFromReport(
        report,
        fixtureGraph(),
        'src/webview',
        'frontend',
    );

    const fi1 = entryFor(checklist, 'FI1');
    assert.ok(fi1, 'FI1 entry present');
    const refs = fi1.candidates.map(c => c.ref);
    assert.deepEqual(
        refs,
        ['src/webview/b.ts', 'src/webview/c.ts'],
        'FI1 keeps only the medium/high modules; low ones gated out',
    );
    assert.equal(fi1.capped, undefined, 'sub-cap FI1 carries no capped metadata');
});

// ---- Case 7: ENC3 is NOT gated (shared interface-width query untouched) ----

test('ENC3 keeps the full ungated width list FI1 gates (per-item gate guard)', () => {
    const report = emptyReport({
        interfaceWidth: [
            widthFinding('src/webview/a.ts', 'low'),
            widthFinding('src/webview/b.ts', 'medium'),
            widthFinding('src/webview/c.ts', 'high'),
            widthFinding('src/webview/d.ts', 'low'),
        ],
    });

    const checklist = reviewRecallFromReport(
        report,
        fixtureGraph(),
        'src/webview',
        'both',
    );

    const enc3 = entryFor(checklist, 'ENC3');
    assert.ok(enc3, 'ENC3 entry present');
    const refs = enc3.candidates.map(c => c.ref);
    assert.deepEqual(
        refs,
        [
            'src/webview/a.ts',
            'src/webview/b.ts',
            'src/webview/c.ts',
            'src/webview/d.ts',
        ],
        'ENC3 carries ALL in-subtree width candidates, including the low ones FI1 drops',
    );
    assert.equal(enc3.capped, undefined, 'ENC3 is never capped');
});

// ---- Case 8: D1 clone gate keeps cross-file / ≥3-member, drops 2-single ----

test('D1 gate keeps cross-file + ≥3-member clones, drops 2-member single-file', () => {
    const report = emptyReport({
        clones: [
            // 2-member single-file → DROP
            cloneFinding(['src/webview/a.ts::f', 'src/webview/a.ts::g']),
            // 2-member cross-file → KEEP
            cloneFinding(['src/webview/a.ts::f', 'src/webview/b.ts::g']),
            // 3-member single-file → KEEP
            cloneFinding([
                'src/webview/a.ts::f',
                'src/webview/a.ts::g',
                'src/webview/a.ts::h',
            ]),
        ],
    });

    const checklist = reviewRecallFromReport(
        report,
        fixtureGraph(),
        'src/webview',
        'general',
    );

    const d1 = entryFor(checklist, 'D1');
    assert.ok(d1, 'D1 entry present');
    const refs = d1.candidates.map(c => c.ref);
    assert.ok(
        !refs.includes('clone:src/webview/a.ts::f|src/webview/a.ts::g'),
        '2-member single-file clone is gated out',
    );
    assert.ok(
        refs.includes('clone:src/webview/a.ts::f|src/webview/b.ts::g'),
        '2-member cross-file clone is kept',
    );
    assert.ok(
        refs.includes(
            'clone:src/webview/a.ts::f|src/webview/a.ts::g|src/webview/a.ts::h',
        ),
        '3-member single-file clone is kept',
    );
    assert.equal(d1.candidates.length, 2, 'exactly the two surviving clones');
});

// ---- Case 9: deterministic cap to N + capped metadata ---------------------

test('FI1 capped to top-15 by ref with honest total metadata', () => {
    // 20 surviving (medium) width findings → cap to 15.
    const total = 20;
    const findings: InterfaceWidthFinding[] = [];
    for (let i = 0; i < total; i++) {
        // zero-pad so lexicographic ref order is the numeric order.
        const n = String(i).padStart(2, '0');
        findings.push(widthFinding(`src/webview/m${n}.ts`, 'medium'));
    }
    const report = emptyReport({ interfaceWidth: findings });

    const checklist = reviewRecallFromReport(
        report,
        fixtureGraph(),
        'src/webview',
        'frontend',
    );

    const fi1 = entryFor(checklist, 'FI1');
    assert.ok(fi1, 'FI1 entry present');
    assert.equal(fi1.candidates.length, 15, 'capped to exactly 15 candidates');
    assert.deepEqual(
        fi1.capped,
        { shown: 15, total: 20 },
        'capped metadata names shown=15, true total=20',
    );
    const refs = fi1.candidates.map(c => c.ref);
    const expected = Array.from({ length: 15 }, (_, i) =>
        `src/webview/m${String(i).padStart(2, '0')}.ts`,
    );
    assert.deepEqual(refs, expected, 'kept the lexicographically-first 15 by ref');
});

// ---- Case 10: gate-to-zero stays graph-blind + emitted --------------------

test('FI1 gated to zero stays graph-blind and is still emitted (no skip)', () => {
    const report = emptyReport({
        interfaceWidth: [
            widthFinding('src/webview/a.ts', 'low'),
            widthFinding('src/webview/b.ts', 'low'),
        ],
    });

    const checklist = reviewRecallFromReport(
        report,
        fixtureGraph(),
        'src/webview',
        'frontend',
    );

    const fi1 = entryFor(checklist, 'FI1');
    assert.ok(fi1, 'FI1 entry still present (never skipped)');
    assert.equal(fi1.candidates.length, 0, 'all low-severity → zero candidates');
    assert.equal(fi1.graphBlind, true, 'gated-to-zero is graph-blind');
    assert.equal(fi1.capped, undefined, 'no capped metadata for a zero entry');
});

// ---- Case 11: determinism with capped FI1/D1 (byte-identical incl capped) --

test('two runs byte-identical with capped FI1 + D1 (capped field included)', () => {
    const widthFindings: InterfaceWidthFinding[] = [];
    for (let i = 0; i < 20; i++) {
        const n = String(i).padStart(2, '0');
        widthFindings.push(widthFinding(`src/webview/m${n}.ts`, 'high'));
    }
    const cloneFindings: CloneFinding[] = [];
    for (let i = 0; i < 20; i++) {
        const n = String(i).padStart(2, '0');
        cloneFindings.push(
            cloneFinding([`src/webview/a.ts::f${n}`, `src/webview/b.ts::g${n}`]),
        );
    }
    const report = emptyReport({
        interfaceWidth: widthFindings,
        clones: cloneFindings,
    });

    const run1 = reviewRecallFromReport(report, fixtureGraph(), 'src/webview', 'both');
    const run2 = reviewRecallFromReport(report, fixtureGraph(), 'src/webview', 'both');

    assert.equal(
        JSON.stringify(run1),
        JSON.stringify(run2),
        'JSON.stringify byte-stable across runs (capped field too)',
    );

    const fi1 = entryFor(run1, 'FI1');
    const d1 = entryFor(run1, 'D1');
    assert.deepEqual(fi1?.capped, { shown: 15, total: 20 }, 'FI1 capped at 15/20');
    assert.deepEqual(d1?.capped, { shown: 15, total: 20 }, 'D1 capped at 15/20');
});
