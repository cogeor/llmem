// tests/unit/cli/review.test.ts
//
// Loop 06 — pure-function tests for the `llmem review` CLI adapter.
//
// Imports PURE helpers DIRECTLY from the command module + capability layer. It
// does NOT spawn `dist/cli/main.js` (all dist-spawning CLI tests live under
// tests/integration/cli/), so this runs without a build. node:test style,
// mirroring tests/unit/cli/find-cycles.test.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';

import { ImportGraph, ImportEdge } from '../../../src/graph/types';
import type {
    HealthReport,
    CycleFinding,
} from '../../../src/application/analysis/types';
import { zeroHealthVector } from '../../../src/application/analysis/types';
import {
    reviewRecallFromReport,
    renderReviewChecklist,
} from '../../../src/application/review';
import { REVIEW_REGISTRY } from '../../../src/application/review/registry';
import { isUnderPath, normalizeReviewPath } from '../../../src/application/review/scope';
import {
    reviewCommand,
    resolveReviewOutPaths,
} from '../../../src/cli/commands/review';
import { REGISTRY } from '../../../src/cli/registry';

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

// ---- registration ----------------------------------------------------------

test('review command is registered with the right name + ruleset/json defaults', () => {
    const found = REGISTRY.find(c => c.name === 'review');
    assert.ok(found, 'review command present in REGISTRY');
    assert.equal(found, reviewCommand, 'registered spec is the exported reviewCommand');

    const parsed = reviewCommand.args.parse({});
    assert.equal(parsed.ruleset, 'both', 'ruleset defaults to both');
    assert.equal(parsed.json, false, 'json defaults to false');
    assert.equal(parsed.path, undefined, 'path is optional');
    assert.equal(parsed.workspace, undefined, 'workspace is optional');
});

// ---- empty path = whole-repo (folder scope, match-all) ---------------------

test("scope treats '' as a match-all folder review (whole repo)", () => {
    assert.equal(normalizeReviewPath(''), '', "normalizeReviewPath('') stays empty");
    assert.equal(
        isUnderPath('src/webview/a.ts', '', 'folder'),
        true,
        "isUnderPath(x, '', 'folder') matches everything",
    );

    // The recall pass over '' surfaces an in-repo cycle (whole-tree review).
    const report = emptyReport({
        importCycles: [cycle('cyc:webview', 'src/webview/a.ts', 'src/webview/b.ts')],
    });
    const checklist = reviewRecallFromReport(report, fixtureGraph(), '', 'both');

    assert.equal(checklist.path, '', "checklist path is the normalized empty root");
    assert.equal(checklist.scope, 'folder', 'empty path reviews as folder scope');
    const dep1 = checklist.entries.find(e => e.item.id === 'DEP1');
    assert.ok(dep1, 'DEP1 entry present');
    assert.equal(dep1.candidates.length, 1, 'whole-repo review surfaces the in-tree cycle');
    assert.equal(dep1.candidates[0].ref, 'cyc:webview');
});

// ---- output parity: same bytes the command prints --------------------------

test('rendered checklist carries every registry id for ruleset both (65 boxes)', () => {
    const checklist = reviewRecallFromReport(emptyReport(), fixtureGraph(), '', 'both');
    const md = renderReviewChecklist(checklist);

    // One unticked box per registry item — the no-skip device.
    const boxCount = (md.match(/- \[ \]/g) ?? []).length;
    assert.equal(boxCount, 65, 'one "- [ ]" box per registry item');
    assert.equal(boxCount, REVIEW_REGISTRY.length, 'box count == registry size');

    for (const item of REVIEW_REGISTRY) {
        assert.ok(
            md.includes(`${item.id} — ${item.title}`),
            `checklist names item ${item.id}`,
        );
    }
});

// ---- resolveReviewOutPaths (pure --out resolution, mirrors health) ---------

test('resolveReviewOutPaths: default writes .llmem/review/<sanitized>.{md,json}', () => {
    const ws = path.join('C:', 'ws');

    const root = resolveReviewOutPaths(ws, '', undefined);
    assert.equal(root.mdPath, path.join(ws, '.llmem', 'review', 'repo.md'));
    assert.equal(root.jsonPath, path.join(ws, '.llmem', 'review', 'repo.json'));

    const sub = resolveReviewOutPaths(ws, 'src/webview', undefined);
    assert.equal(sub.mdPath, path.join(ws, '.llmem', 'review', 'src__webview.md'));
    assert.equal(sub.jsonPath, path.join(ws, '.llmem', 'review', 'src__webview.json'));
});

test('resolveReviewOutPaths: --out ending in .md is the md path; json is its sibling', () => {
    // path.resolve yields a genuinely-absolute path for the HOST OS, so the
    // isAbsolute branch fires on POSIX CI as well as Windows. (A literal
    // 'C:/...' fixture only counts as absolute on win32 and would be joined
    // onto the workspace on Linux.)
    const ws = path.resolve('ws');
    const out = path.resolve('tmp', 'r.md');
    const { mdPath, jsonPath } = resolveReviewOutPaths(ws, 'src', out);
    assert.equal(mdPath, out);
    assert.equal(jsonPath, path.resolve('tmp', 'r.json'));
});

test('resolveReviewOutPaths: --out directory joins the sanitized default names', () => {
    const ws = path.resolve('ws');
    const out = path.resolve('reports');
    const { mdPath, jsonPath } = resolveReviewOutPaths(ws, 'src/webview', out);
    assert.equal(mdPath, path.join(out, 'src__webview.md'));
    assert.equal(jsonPath, path.join(out, 'src__webview.json'));
});

test('resolveReviewOutPaths: a relative --out resolves against the workspace', () => {
    const ws = path.join('C:', 'ws');
    const { mdPath } = resolveReviewOutPaths(ws, '', 'reports');
    assert.equal(mdPath, path.join(ws, 'reports', 'repo.md'));
});
