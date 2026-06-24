// tests/unit/application/analysis/interface-width-severity.test.ts
//
// Loop 04 — pure-function tests for the dynamic-percentile severity
// calibration (`calibrateInterfaceWidthSeverity`) and the `quantile` helper.
//
// Tests `calibrateInterfaceWidthSeverity` DIRECTLY with hand-built
// `InterfaceWidthFinding[]` (no graph, no IO). node:test style.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    quantile,
    calibrateInterfaceWidthSeverity,
} from '../../../../src/application/analysis/interface-width';
import type { InterfaceWidthFinding } from '../../../../src/application/analysis/types';

// ---- fixture helper -------------------------------------------------------

// Build a folder finding with explicit w / wEff / dmr / treeDepth. moduleDepth
// is derived (dmr*wEff) only for label realism; the calibration reads w/wEff/dmr.
const folder = (
    name: string,
    w: number,
    wEff: number,
    dmr: number,
    treeDepth = 1,
): InterfaceWidthFinding => ({
    id: 'iw:folder:' + name,
    type: 'interface-width',
    severity: 'low',
    module: name,
    scope: 'folder',
    treeDepth,
    w,
    wEff,
    moduleDepth: Math.round(dmr * wEff),
    dmr,
    topEntryPoints: [],
    relatedFiles: [name],
    title: `W=${w} W_eff=${wEff.toFixed(2)} depth=${Math.round(dmr * wEff)} DMR=${dmr.toFixed(2)}`,
    detail: `folder ${name}`,
});

const fn = (
    name: string,
    inbound: number,
): InterfaceWidthFinding => ({
    id: 'iw:fn:' + name,
    type: 'interface-width',
    severity: 'low',
    module: name,
    scope: 'function',
    treeDepth: 1,
    w: 1,
    wEff: 1,
    moduleDepth: 1,
    dmr: 1,
    topEntryPoints: [{ entity: name, inbound }],
    relatedFiles: [name],
    title: `W=1 W_eff=1.00 depth=1 DMR=1.00`,
    detail: `function ${name}`,
});

const byId = (
    findings: InterfaceWidthFinding[],
    id: string,
): InterfaceWidthFinding => {
    const f = findings.find(x => x.id === id);
    assert.ok(f, `finding ${id} exists`);
    return f;
};

// A ≥8-folder distribution with one clear shallow-wide outlier (high wEff, low
// dmr) and one deep-narrow folder (high dmr). The 7 fillers are all narrow
// (wEff ≤ ~3, below the outlier's 9) AND deep (high dmr, above dmrP25) so ONLY
// the outlier clears both `wEff >= max(p75,2)` and `dmr <= dmrP25`.
//   - shallow-wide: wEff=9, dmr=2     (the src/cli/commands analog)
//   - deep-narrow:  wEff=2, dmr=20    (high dmr ⇒ never shallow-wide)
//   - 7 fillers:    wEff 1..3, dmr 8..14 (all > dmrP25 ⇒ never shallow-wide)
function makeDistribution(): InterfaceWidthFinding[] {
    const fillers = [
        folder('src/f0', 2, 1.0, 8),
        folder('src/f1', 2, 1.5, 9),
        folder('src/f2', 3, 2.0, 10),
        folder('src/f3', 2, 1.2, 11),
        folder('src/f4', 3, 2.5, 12),
        folder('src/f5', 2, 1.8, 13),
        folder('src/f6', 3, 3.0, 14),
    ];
    return [
        folder('src/cli/commands', 9, 9.0, 2.0, 2), // shallow-wide outlier
        folder('src/deep', 1, 2.0, 20.0, 1), // deep-narrow
        ...fillers,
    ].sort((a, b) => a.id.localeCompare(b.id));
}

// ---- quantile correctness -------------------------------------------------

test('quantile: linear interpolation on a known array', () => {
    const a = [1, 2, 3, 4, 5]; // n=5
    assert.equal(quantile(a, 0), 1);
    assert.equal(quantile(a, 1), 5);
    assert.equal(quantile(a, 0.5), 3); // median
    assert.equal(quantile(a, 0.25), 2); // rank=1.0
    assert.equal(quantile(a, 0.75), 4); // rank=3.0
});

test('quantile: interpolates between elements', () => {
    const a = [0, 10]; // n=2, rank = p*(n-1) = p
    assert.equal(quantile(a, 0.5), 5);
    assert.equal(quantile(a, 0.25), 2.5);
    assert.equal(quantile(a, 0.9), 9);
});

test('quantile: empty ⇒ 0; single ⇒ that element', () => {
    assert.equal(quantile([], 0.5), 0);
    assert.equal(quantile([42], 0.5), 42);
    assert.equal(quantile([42], 0), 42);
});

// ---- shallow-wide promotion -----------------------------------------------

test('shallow-wide outlier ⇒ medium [shallow-wide]; deep-narrow stays low', () => {
    const out = calibrateInterfaceWidthSeverity(makeDistribution());

    const shallow = byId(out, 'iw:folder:src/cli/commands');
    assert.equal(shallow.severity, 'medium', 'shallow-wide promoted to medium');
    assert.ok(
        shallow.title.startsWith('[shallow-wide] '),
        'shallow-wide title prefixed',
    );

    const deep = byId(out, 'iw:folder:src/deep');
    assert.equal(deep.severity, 'low', 'deep-narrow (high dmr) stays low');
    assert.ok(
        !deep.title.startsWith('[shallow-wide]'),
        'deep-narrow not prefixed',
    );

    // Exactly one shallow-wide hit in this distribution.
    const medium = out.filter(f => f.severity === 'medium');
    assert.equal(medium.length, 1, 'exactly one shallow-wide medium');
});

test('treeDepth 0 (root) is never shallow-wide even with high wEff / low dmr', () => {
    const dist = makeDistribution();
    // Add a root-level (treeDepth 0) folder that would otherwise qualify.
    dist.push(folder('src', 12, 12.0, 1.0, 0));
    const out = calibrateInterfaceWidthSeverity(
        dist.sort((a, b) => a.id.localeCompare(b.id)),
    );
    assert.equal(byId(out, 'iw:folder:src').severity, 'low', 'root stays low');
});

// ---- small-repo guard -----------------------------------------------------

test('< MIN_CALIBRATION_N folders ⇒ all low (small-repo guard)', () => {
    // 7 folders (below the floor of 8), including a would-be shallow-wide.
    const small = [
        folder('src/cli/commands', 9, 9.0, 2.0, 2),
        folder('src/f0', 2, 1.0, 8),
        folder('src/f1', 2, 1.5, 7),
        folder('src/f2', 3, 2.0, 9),
        folder('src/f3', 2, 1.2, 10),
        folder('src/f4', 3, 2.5, 6),
        folder('src/f5', 2, 1.8, 11),
    ].sort((a, b) => a.id.localeCompare(b.id));
    const out = calibrateInterfaceWidthSeverity(small);
    for (const f of out) {
        assert.equal(f.severity, 'low', `${f.module} stays low under the floor`);
    }
});

// ---- wide-utility function annotation -------------------------------------

test('function inbound >= cut ⇒ [wide-utility] note but stays low', () => {
    const dist = makeDistribution();
    // Add functions: one wide utility (inbound 12) + low-traffic ones.
    dist.push(fn('src/logger.ts::log', 12));
    dist.push(fn('src/a.ts::small', 1));
    const out = calibrateInterfaceWidthSeverity(
        dist.sort((a, b) => a.id.localeCompare(b.id)),
    );

    const util = byId(out, 'iw:fn:src/logger.ts::log');
    assert.equal(util.severity, 'low', 'wide-utility stays low (rank-not-gate)');
    assert.ok(
        util.title.startsWith('[wide-utility] '),
        'wide-utility title prefixed',
    );

    const small = byId(out, 'iw:fn:src/a.ts::small');
    assert.equal(small.severity, 'low');
    assert.ok(!small.title.startsWith('[wide-utility]'), 'low-traffic fn not noted');
});

// ---- determinism / order preservation -------------------------------------

test('determinism: calibrate twice ⇒ identical; order unchanged (id-sorted)', () => {
    const a = calibrateInterfaceWidthSeverity(makeDistribution());
    const run1 = JSON.stringify(a);
    // Idempotent: re-calibrating its own output is a no-op.
    const run2 = JSON.stringify(calibrateInterfaceWidthSeverity(a));
    assert.equal(run1, run2, 'calibration is idempotent / deterministic');

    // Order preserved (still id-sorted ascending).
    const ids = a.map(f => f.id);
    const sorted = [...ids].sort((x, y) => x.localeCompare(y));
    assert.deepEqual(ids, sorted, 'order is the id-sorted input order');
});

test('calibrate returns the same array reference (in-place, order-preserving)', () => {
    const input = makeDistribution();
    const out = calibrateInterfaceWidthSeverity(input);
    assert.equal(out, input, 'same array reference — never reorders');
});
