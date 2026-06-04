/**
 * LS-04 — renderCoverageCaveat: the §7 "COVERAGE NOTES" caveat block.
 *
 * Pins the exact wording (the prompt template depends on it) and the
 * iff-non-empty behavior:
 *   - returns '' when every skip bucket is empty (caveat OMITTED).
 *   - emits the header + one line per skipped file (grouped size → lines →
 *     denylist) + trailer when ANY bucket is non-empty.
 *   - the limit values (maxFileSizeKB / maxFileLines) are interpolated.
 *
 * Drives `renderCoverageCaveat` directly — no scan, no I/O.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { renderCoverageCaveat } from '../../../src/application/coverage-caveat';
import type { ScanCoverage } from '../../../src/application/scan';

const CFG = { maxFileSizeKB: 512, maxFileLines: 1500 };

function coverage(over: Partial<ScanCoverage> = {}): ScanCoverage {
    return {
        skippedSize: [],
        skippedLines: [],
        skippedDenylist: [],
        parseErrors: [],
        ...over,
    };
}

test('returns empty string when every skip bucket is empty', () => {
    assert.equal(renderCoverageCaveat(coverage(), CFG), '');
});

test('display-only overFileCap / parseErrors alone do NOT trigger the block', () => {
    const cov = coverage({
        overFileCap: 5,
        parseErrors: [{ filePath: 'a.ts', message: 'boom', cause: null }],
    });
    assert.equal(renderCoverageCaveat(cov, CFG), '');
});

test('renders header, per-file reasons (size→lines→denylist), and trailer', () => {
    const cov = coverage({
        skippedSize: ['src/big.ts'],
        skippedLines: ['src/long.ts'],
        skippedDenylist: ['src/gen.d.ts'],
    });
    const out = renderCoverageCaveat(cov, CFG);
    const expected = [
        '## ⚠️ COVERAGE NOTES (graph may be incomplete)',
        'src/big.ts — exceeds size limit (512 KB)',
        'src/long.ts — exceeds line limit (1500)',
        'src/gen.d.ts — generated/declaration file (denylist)',
        'The summary above is based on the remaining files only.',
    ].join('\n');
    assert.equal(out, expected);
});

test('renders the block when only one bucket is non-empty', () => {
    const out = renderCoverageCaveat(coverage({ skippedSize: ['x.ts'] }), CFG);
    const expected = [
        '## ⚠️ COVERAGE NOTES (graph may be incomplete)',
        'x.ts — exceeds size limit (512 KB)',
        'The summary above is based on the remaining files only.',
    ].join('\n');
    assert.equal(out, expected);
});

test('interpolates the configured limit values', () => {
    const out = renderCoverageCaveat(
        coverage({ skippedSize: ['a'], skippedLines: ['b'] }),
        { maxFileSizeKB: 64, maxFileLines: 300 },
    );
    assert.match(out, /a — exceeds size limit \(64 KB\)/);
    assert.match(out, /b — exceeds line limit \(300\)/);
});

test('preserves per-bucket path order and lists every file', () => {
    const cov = coverage({
        skippedSize: ['z.ts', 'a.ts'],
        skippedDenylist: ['m.min.js'],
    });
    const out = renderCoverageCaveat(cov, CFG);
    const expected = [
        '## ⚠️ COVERAGE NOTES (graph may be incomplete)',
        'z.ts — exceeds size limit (512 KB)',
        'a.ts — exceeds size limit (512 KB)',
        'm.min.js — generated/declaration file (denylist)',
        'The summary above is based on the remaining files only.',
    ].join('\n');
    assert.equal(out, expected);
});
