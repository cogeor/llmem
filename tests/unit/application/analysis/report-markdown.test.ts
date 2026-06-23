// tests/unit/application/analysis/report-markdown.test.ts
//
// Loop 01 — determinism + timestamp-freedom of `renderHealthReport`.
//
// Constructs a `HealthReport` literal in-memory (no analyzers run) and asserts
// the renderer is byte-deterministic and emits no date/timestamp. node:test
// style.

import test from 'node:test';
import assert from 'node:assert/strict';

import { HealthReport } from '../../../../src/application/analysis/types';
import { renderHealthReport } from '../../../../src/application/analysis/report-markdown';

const report: HealthReport = {
    repo: 'demo',
    vector: {
        importCyclesRuntime: 1,
        importCyclesInclTypeOnly: 1,
        callCyclesMutual: 0,
        callCyclesRecursion: 0,
        cloneClustersHigh: 0,
        cloneClustersTotal: 0,
        maxFanIn: 0,
        hubOutliers: 0,
        filesOverBudget: 0,
    },
    importCycles: [
        {
            id: 'import-cycle:src/a.ts|src/b.ts',
            type: 'import-cycle',
            kind: 'import-cycle',
            severity: 'high',
            title: '2-file import cycle',
            detail: 'Import cycle through src/a.ts -> src/b.ts -> src/a.ts',
            relatedFiles: ['src/a.ts', 'src/b.ts'],
            members: ['src/a.ts', 'src/b.ts'],
            shortestPath: ['src/a.ts', 'src/b.ts', 'src/a.ts'],
        },
    ],
    callCycles: [],
    clones: [],
    hubs: [],
};

test('renderHealthReport: byte-identical across two calls on the same input', () => {
    assert.equal(renderHealthReport(report), renderHealthReport(report));
});

test('renderHealthReport: contains no ISO date / timestamp', () => {
    const out = renderHealthReport(report);
    assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(out), 'no ISO datetime');
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(out), 'no ISO date');
});

test('renderHealthReport: includes the import-cycles section and the closed hop path', () => {
    const out = renderHealthReport(report);
    assert.ok(out.includes('## 1. Import cycles'));
    assert.ok(out.includes('src/a.ts -> src/b.ts -> src/a.ts'));
});
