// tests/unit/application/analysis/report-markdown.test.ts
//
// Loop 01 — determinism + timestamp-freedom of `renderHealthReport`.
//
// Constructs a `HealthReport` literal in-memory (no analyzers run) and asserts
// the renderer is byte-deterministic and emits no date/timestamp. node:test
// style.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    HealthReport,
    InterfaceWidthFinding,
} from '../../../../src/application/analysis/types';
import { renderHealthReport } from '../../../../src/application/analysis/report-markdown';

/** A shallow-wide folder finding (the actionable medium smell). */
const shallowWideFolder: InterfaceWidthFinding = {
    id: 'iw:folder:src/cli/commands',
    type: 'interface-width',
    severity: 'medium',
    module: 'src/cli/commands',
    scope: 'folder',
    treeDepth: 2,
    w: 9,
    wEff: 8.5,
    moduleDepth: 12,
    dmr: 1.41,
    topEntryPoints: [{ entity: 'src/cli/commands/health.ts', inbound: 3 }],
    title: '[shallow-wide] W=9 W_eff=8.50 depth=12 DMR=1.41',
    detail: 'folder src/cli/commands: 9 external entry point(s)',
    relatedFiles: ['src/cli/commands'],
};

/** A context (non-medium) folder finding with w > 0. */
const contextFolder: InterfaceWidthFinding = {
    id: 'iw:folder:src/graph',
    type: 'interface-width',
    severity: 'low',
    module: 'src/graph',
    scope: 'folder',
    treeDepth: 1,
    w: 5,
    wEff: 3.2,
    moduleDepth: 40,
    dmr: 12.5,
    topEntryPoints: [{ entity: 'src/graph/edgelist.ts', inbound: 7 }],
    title: 'W=5 W_eff=3.20 depth=40 DMR=12.50',
    detail: 'folder src/graph: 5 external entry point(s)',
    relatedFiles: ['src/graph'],
};

/** A shared-utility function surface (informational). */
const utilFn: InterfaceWidthFinding = {
    id: 'iw:fn:src/logger.ts#log',
    type: 'interface-width',
    severity: 'low',
    module: 'src/logger.ts#log',
    scope: 'function',
    treeDepth: 0,
    w: 1,
    wEff: 1,
    moduleDepth: 1,
    dmr: 1,
    topEntryPoints: [{ entity: 'src/logger.ts#log', inbound: 26 }],
    title: '[wide-utility] W=1 W_eff=1.00 depth=1 DMR=1.00',
    detail: 'function src/logger.ts#log: 1 external entry point(s)',
    relatedFiles: ['src/logger.ts#log'],
};

function makeReport(interfaceWidth: InterfaceWidthFinding[]): HealthReport {
    const shallowWide = interfaceWidth.filter(
        f => f.scope === 'folder' && f.severity === 'medium',
    ).length;
    const maxEffectiveWidth = interfaceWidth
        .filter(f => f.scope === 'folder')
        .reduce((max, f) => Math.max(max, f.wEff), 0);
    return {
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
            hubUnstable: 0,
            filesOverBudget: 0,
            maxEffectiveWidth,
            interfaceWidthShallowWide: shallowWide,
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
        interfaceWidth,
    };
}

const report: HealthReport = makeReport([
    shallowWideFolder,
    contextFolder,
    utilFn,
]);

test('renderHealthReport: byte-identical across two calls on the same input', () => {
    assert.equal(renderHealthReport(report), renderHealthReport(report));
});

// C1: the graph size header replaces the deleted `stats` command.
test('renderHealthReport: graph header line when report.graph present, absent otherwise', () => {
    const withGraph: HealthReport = {
        ...makeReport([]),
        graph: { files: 42, importEdges: 100, callEdges: 250 },
    };
    const out = renderHealthReport(withGraph);
    assert.ok(
        out.includes('graph: 42 files, 100 import edges, 250 call edges'),
        `graph header rendered:\n${out}`,
    );
    // Hand-built fixture reports (no graph field) stay renderable, no header.
    assert.ok(!renderHealthReport(makeReport([])).includes('graph: '), 'no header without data');
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

// A2 (2026-07-13 review, bug 1.2): the cycle header counts the whole SCC but
// the body only showed the SHORTEST loop — "13-file cycle" followed by a
// 2-file path read as a contradiction. The renderer now lists the members
// (capped at 20) and labels the path as an example loop.
function reportWithCycle(members: string[], shortestPath: string[]): HealthReport {
    const base = makeReport([]);
    return {
        ...base,
        importCycles: [
            {
                id: `import-cycle:${members.join('|')}`,
                type: 'import-cycle',
                kind: 'import-cycle',
                severity: 'high',
                title: `${members.length}-file import cycle`,
                detail: `Import cycle through ${shortestPath.join(' -> ')}`,
                relatedFiles: members,
                members,
                shortestPath,
                typeOnlyEdgeCount: 0,
                totalEdgeCount: members.length,
                runtimeMembers: members,
            },
        ],
    };
}

test('renderHealthReport: cycle lists all members and labels the example loop', () => {
    const members = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
    const out = renderHealthReport(
        reportWithCycle(members, ['src/a.ts', 'src/b.ts', 'src/a.ts']),
    );
    assert.ok(out.includes('Cycle 1: 3-file cycle'), `header counts SCC:\n${out}`);
    assert.ok(
        out.includes('  members: src/a.ts, src/b.ts, src/c.ts'),
        `members line lists the whole SCC:\n${out}`,
    );
    assert.ok(
        out.includes('  example loop (shortest): src/a.ts -> src/b.ts -> src/a.ts'),
        `path is labeled as an example loop:\n${out}`,
    );
});

test('renderHealthReport: cycle members cap at 20 with a +N more suffix', () => {
    const members = Array.from({ length: 25 }, (_, i) =>
        `src/m${String(i).padStart(2, '0')}.ts`,
    );
    const out = renderHealthReport(
        reportWithCycle(members, [members[0], members[1], members[0]]),
    );
    assert.ok(out.includes('Cycle 1: 25-file cycle'));
    assert.ok(out.includes('src/m19.ts, … +5 more'), `cap line present:\n${out}`);
    assert.ok(!out.includes('src/m20.ts,'), `members beyond the cap are elided:\n${out}`);
});

test('renderHealthReport: renders the Module interfaces section with the shallow-wide row', () => {
    const out = renderHealthReport(report);
    assert.ok(out.includes('## 5. Module interfaces'), 'section header present');
    assert.ok(out.includes('### Shallow-wide modules'), 'shallow-wide sub-list');
    // The medium folder is listed with its W / W_eff columns.
    assert.ok(
        out.includes('| src/cli/commands | 9 | 8.50 | 12 | 1.41 |'),
        `shallow-wide row rendered; got:\n${out}`,
    );
    // The context folder appears in the widest-folders window.
    assert.ok(out.includes('### Widest folders (context)'));
    assert.ok(out.includes('| src/graph | 5 | 3.20 | 40 | 12.50 |'));
    // The function surface is informational.
    assert.ok(out.includes('### Shared-utility surfaces (informational)'));
    assert.ok(out.includes('| src/logger.ts#log | 26 |'));
    // Scorecard carries the two new vector lines.
    assert.ok(out.includes('interface width: max W_eff 8.50, 1 shallow-wide module(s)'));
});

// A4 (2026-07-13 review): the markdown Duplication section lists exact-body
// clusters only; shared-literal clusters collapse to one summary line (they
// stay in the JSON as review-recall bait). The scorecard headline counts
// exact-body high clusters.
function reportWithClones(): HealthReport {
    const base = makeReport([]);
    const clones: HealthReport['clones'] = [
        {
            id: 'clone:HASH1:src/cli/x.ts::f|src/webview/y.ts::g',
            type: 'clone',
            cloneType: 'exact-body',
            similarity: 1,
            severity: 'high',
            title: '2-member exact-body clone (cross-layer)',
            detail: 'd',
            relatedFiles: ['src/cli/x.ts', 'src/webview/y.ts'],
            members: ['src/cli/x.ts::f', 'src/webview/y.ts::g'],
        },
        {
            id: 'clone-lit:arr:HASH2:src/a.ts::f|src/b.ts::g',
            type: 'clone',
            cloneType: 'shared-literal',
            sharedKind: 'array',
            similarity: 1,
            severity: 'high',
            title: '2-member shared-literal clone [array] (cross-layer)',
            detail: 'd',
            relatedFiles: ['src/a.ts', 'src/b.ts'],
            members: ['src/a.ts::f', 'src/b.ts::g'],
        },
        {
            id: 'clone-lit:str:HASH3:src/c.ts::f|src/d.ts::g',
            type: 'clone',
            cloneType: 'shared-literal',
            sharedKind: 'string',
            similarity: 1,
            severity: 'medium',
            title: '2-member shared-literal clone [string] (same-module)',
            detail: 'd',
            relatedFiles: ['src/c.ts', 'src/d.ts'],
            members: ['src/c.ts::f', 'src/d.ts::g'],
        },
    ];
    return {
        ...base,
        vector: { ...base.vector, cloneClustersTotal: clones.length, cloneClustersHigh: 2 },
        clones,
    };
}

test('renderHealthReport: duplication lists exact-body only, literals collapse to a summary line', () => {
    const out = renderHealthReport(reportWithClones());
    assert.ok(out.includes('Found 1 exact-body clone cluster(s):'), `exact-body header:\n${out}`);
    assert.ok(out.includes('src/cli/x.ts::f, src/webview/y.ts::g'), 'exact-body members listed');
    assert.ok(
        out.includes('shared-literal clusters: 2 (feeding review items D1/D2) — see JSON'),
        `literal summary line:\n${out}`,
    );
    assert.ok(!out.includes('[shared-literal:'), 'no per-cluster shared-literal rows in markdown');
});

test('renderHealthReport: clone scorecard counts exact-body highs against the recall total', () => {
    const out = renderHealthReport(reportWithClones());
    // 1 exact-body high (the shared-literal high does NOT count) / 3 total.
    assert.ok(
        out.includes('clone clusters: 1 high (exact-body, cross-module, non-test) / 3 total'),
        `scorecard clone line:\n${out}`,
    );
});

test('renderHealthReport: "No exact-body duplication found." when only literal clusters exist', () => {
    const withOnlyLiterals = {
        ...reportWithClones(),
    };
    withOnlyLiterals.clones = withOnlyLiterals.clones.filter(
        c => c.cloneType === 'shared-literal',
    );
    const out = renderHealthReport(withOnlyLiterals);
    assert.ok(out.includes('No exact-body duplication found.'));
    assert.ok(out.includes('shared-literal clusters: 2 (feeding review items D1/D2) — see JSON'));
});

// A3 (2026-07-13 review): the hub section conflated signal with context —
// llmem itself reported 101 "hub outliers", mostly healthy kernels. The
// renderer now leads with unstable hubs (all of them) and caps kernels at 10
// context rows; the scorecard splits the counts.
function reportWithHubs(unstable: number, kernel: number): HealthReport {
    const base = makeReport([]);
    const hub = (i: number, label: 'unstable-hub' | 'kernel'): HealthReport['hubs'][number] => ({
        id: `hub:src/${label}${String(i).padStart(2, '0')}.ts`,
        type: 'hub',
        severity: 'medium',
        title: `hub ${label} ${i}`,
        detail: 'd',
        relatedFiles: [`src/${label}${String(i).padStart(2, '0')}.ts`],
        ca: label === 'kernel' ? 10 : 5,
        ce: label === 'kernel' ? 1 : 6,
        instability: label === 'kernel' ? 0.09 : 0.55,
        label,
    });
    const hubs = [
        ...Array.from({ length: unstable }, (_, i) => hub(i, 'unstable-hub')),
        ...Array.from({ length: kernel }, (_, i) => hub(i, 'kernel')),
    ];
    return {
        ...base,
        vector: {
            ...base.vector,
            hubOutliers: hubs.length,
            hubUnstable: unstable,
            maxFanIn: 10,
        },
        hubs,
    };
}

test('renderHealthReport: hub scorecard splits unstable vs kernel counts', () => {
    const out = renderHealthReport(reportWithHubs(2, 12));
    assert.ok(
        out.includes('hubs: 2 unstable / 12 kernel (max fan-in 10)'),
        `scorecard line splits counts; got:\n${out}`,
    );
});

test('renderHealthReport: all unstable hubs listed, kernels capped at 10', () => {
    const out = renderHealthReport(reportWithHubs(2, 12));
    assert.ok(out.includes('### Unstable hubs'));
    assert.ok(out.includes('| src/unstable-hub00.ts | 5 | 6 | 0.55 |'));
    assert.ok(out.includes('| src/unstable-hub01.ts | 5 | 6 | 0.55 |'));
    assert.ok(out.includes('### Kernels (context — healthy shared dependencies)'));
    assert.ok(out.includes('| src/kernel09.ts | 10 | 1 | 0.09 |'), 'kernel 10 of 12 shown');
    assert.ok(!out.includes('src/kernel10.ts'), 'kernel 11 elided by the cap');
    assert.ok(out.includes('… +2 more kernels (see JSON)'), `cap suffix present:\n${out}`);
});

test('renderHealthReport: empty hub sections render their no-findings lines', () => {
    const out = renderHealthReport(reportWithHubs(0, 0));
    assert.ok(out.includes('No unstable hubs found.'));
    assert.ok(out.includes('No kernels flagged.'));
});

test('renderHealthReport: "No shallow-wide modules." when no medium folder finding', () => {
    const out = renderHealthReport(makeReport([contextFolder, utilFn]));
    assert.ok(out.includes('## 5. Module interfaces'));
    assert.ok(out.includes('No shallow-wide modules.'), `got:\n${out}`);
    assert.ok(out.includes('interface width: max W_eff 3.20, 0 shallow-wide module(s)'));
});
