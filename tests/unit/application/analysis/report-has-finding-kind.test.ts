/**
 * D2 (2026-07-13) — unit coverage for `reportHasFindingKind`, the pure
 * predicate behind `health --fail-on <kind>`. Every branch of the 7-way
 * switch gets a fixture, including the regression the 2026-07-13 review
 * flagged as UNCOVERED: `import-cycle` must key on the RUNTIME count, so a
 * cycle held together solely by `import type` edges never fails CI.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { reportHasFindingKind } from '../../../../src/application/analysis';
import {
    zeroHealthVector,
    type HealthReport,
    type CycleFinding,
    type Finding,
} from '../../../../src/application/analysis/types';

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

const cycleFinding = (kind: CycleFinding['kind']): CycleFinding => ({
    id: `c:${kind}`,
    type: kind,
    kind,
    severity: 'high',
    title: 't',
    detail: 'd',
    relatedFiles: [],
    members: ['a', 'b'],
    shortestPath: ['a', 'b', 'a'],
});

const recursionFinding = (): Finding => ({
    id: 'r1',
    type: 'recursion',
    severity: 'low',
    title: 'self-recursion',
    detail: 'd',
    relatedFiles: [],
});

describe('reportHasFindingKind', () => {
    test('empty report: every known kind (and an unknown one) is false', () => {
        const report = emptyReport();
        for (const kind of [
            'import-cycle', 'call-cycle', 'clone', 'hub', 'recursion',
            'interface-width', 'nonsense', '',
        ]) {
            assert.equal(reportHasFindingKind(report, kind), false, kind);
        }
    });

    test('import-cycle keys on the RUNTIME count — a type-only cycle does not trip', () => {
        // The full-graph SCC array has a cycle, but its runtime core
        // collapsed (importCyclesRuntime stays 0) — the gate must NOT fire.
        const typeOnly: HealthReport = {
            ...emptyReport(),
            vector: { ...zeroHealthVector(), importCyclesInclTypeOnly: 1 },
            importCycles: [cycleFinding('import-cycle')],
        };
        assert.equal(reportHasFindingKind(typeOnly, 'import-cycle'), false);

        const runtime: HealthReport = {
            ...typeOnly,
            vector: { ...typeOnly.vector, importCyclesRuntime: 1 },
        };
        assert.equal(reportHasFindingKind(runtime, 'import-cycle'), true);
    });

    test('call-cycle reads report.callCycles', () => {
        const report: HealthReport = {
            ...emptyReport(),
            callCycles: [cycleFinding('call-cycle')],
        };
        assert.equal(reportHasFindingKind(report, 'call-cycle'), true);
        assert.equal(reportHasFindingKind(report, 'recursion'), false, 'call cycles are not recursion');
    });

    test('recursion reads report.recursion (NOT callCycles), tolerating absence', () => {
        const report: HealthReport = { ...emptyReport(), recursion: [recursionFinding()] };
        assert.equal(reportHasFindingKind(report, 'recursion'), true);

        const withoutField: HealthReport = { ...emptyReport() };
        delete withoutField.recursion;
        assert.equal(reportHasFindingKind(withoutField, 'recursion'), false);
    });

    test('clone reads report.clones', () => {
        const report: HealthReport = {
            ...emptyReport(),
            clones: [{
                id: 'cl', type: 'clone', severity: 'low', title: 't', detail: 'd',
                relatedFiles: [], cloneType: 'exact-body', similarity: 1, members: ['a', 'b'],
            }],
        };
        assert.equal(reportHasFindingKind(report, 'clone'), true);
    });

    test('hub reads report.hubs', () => {
        const report: HealthReport = {
            ...emptyReport(),
            hubs: [{
                id: 'h', type: 'hub', severity: 'medium', title: 't', detail: 'd',
                relatedFiles: ['x.ts'], ca: 9, ce: 1, instability: 0.1, label: 'kernel',
            }],
        };
        assert.equal(reportHasFindingKind(report, 'hub'), true);
    });

    test('interface-width fires on the shallow-wide SMELL count, not mere findings', () => {
        const withFindingsOnly: HealthReport = {
            ...emptyReport(),
            interfaceWidth: [{
                id: 'iw', type: 'interface-width', severity: 'low', title: 't', detail: 'd',
                relatedFiles: [], module: 'src/x', scope: 'folder', treeDepth: 1,
                w: 3, wEff: 2, moduleDepth: 10, dmr: 5, topEntryPoints: [],
            }],
        };
        assert.equal(
            reportHasFindingKind(withFindingsOnly, 'interface-width'),
            false,
            'every real repo has width findings — only the smell gates',
        );

        const withSmell: HealthReport = {
            ...withFindingsOnly,
            vector: { ...zeroHealthVector(), interfaceWidthShallowWide: 1 },
        };
        assert.equal(reportHasFindingKind(withSmell, 'interface-width'), true);
    });
});
