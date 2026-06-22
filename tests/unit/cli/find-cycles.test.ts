// tests/unit/cli/find-cycles.test.ts
//
// Loop 03 — pure-function tests for the find-cycles report builder.
//
// Imports `buildCycleReport` DIRECTLY from the command module. It does NOT spawn
// `dist/cli/main.js` (all dist-spawning CLI tests live under
// tests/integration/cli/), so this runs without a build. node:test style,
// mirroring tests/unit/graph/scc.test.ts.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ImportGraph, ImportEdge } from '../../../src/graph/types';
import { buildCycleReport } from '../../../src/cli/commands/find-cycles';

// import-edge literal with the required ImportEdge fields.
const ie = (source: string, target: string): ImportEdge =>
    ({ source, target, kind: 'import', specifiers: [] });

// build an ImportGraph from explicit ids + edges (file nodes; ids are POSIX).
const g = (ids: string[], edges: ImportEdge[]): ImportGraph => ({
    nodes: new Map(
        ids.map(id => [
            id,
            { id, kind: 'file', label: id, path: id, language: 'unknown' },
        ]),
    ),
    edges,
});

test('buildCycleReport: known a<->b cycle lists members and a closed hop path', () => {
    const graph = g(
        ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        [
            ie('src/a.ts', 'src/b.ts'),
            ie('src/b.ts', 'src/a.ts'),
            ie('src/b.ts', 'src/c.ts'), // acyclic tail
        ],
    );
    const report = buildCycleReport(graph);

    assert.ok(report.includes('src/a.ts'), 'names member a');
    assert.ok(report.includes('src/b.ts'), 'names member b');
    assert.ok(
        report.includes('src/a.ts -> src/b.ts -> src/a.ts'),
        `closed hop path present; got:\n${report}`,
    );
    assert.ok(!report.includes('No import cycles found.'), 'not the no-cycles phrase');
});

test('buildCycleReport: acyclic graph returns exactly the no-cycles phrase', () => {
    const graph = g(
        ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        [ie('src/a.ts', 'src/b.ts'), ie('src/b.ts', 'src/c.ts')],
    );
    assert.equal(buildCycleReport(graph), 'No import cycles found.');
});

test('buildCycleReport: 3-node cycle lists all members with a closed path; tail excluded', () => {
    const graph = g(
        ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
        [
            ie('src/a.ts', 'src/b.ts'),
            ie('src/b.ts', 'src/c.ts'),
            ie('src/c.ts', 'src/a.ts'),
            ie('src/c.ts', 'src/d.ts'), // dangling tail
        ],
    );
    const report = buildCycleReport(graph);

    assert.ok(report.includes('src/a.ts'));
    assert.ok(report.includes('src/b.ts'));
    assert.ok(report.includes('src/c.ts'));
    assert.ok(
        report.includes('src/a.ts -> src/b.ts -> src/c.ts -> src/a.ts'),
        `closed 3-node hop path present; got:\n${report}`,
    );
    // 'd' is not part of any cycle block (only the tail edge mentions it,
    // and that edge is not rendered).
    assert.ok(!report.includes('src/d.ts'), 'dangling node d not in any cycle block');
});
