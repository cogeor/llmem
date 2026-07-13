// tests/unit/application/analysis/clones.test.ts
//
// Loop 06 — pure-function tests for the clone analyzer's bucketing/ranking plus
// a thin end-to-end check of the Type-2 normalizer. No IO, no parse, no ctx.
//
// Covers:
//   1. Two functions identical modulo identifier/literal names ⇒ one cluster
//      (drives normalizeBody + sha256Hex + clusterClones end to end).
//   2. A <20-token entity is skipped (noise floor).
//   3. same-file pair ranks lower (low) than cross-layer pair (high).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    clusterClones,
    type EntityHash,
} from '../../../../src/application/analysis/clones';
import {
    clusterSeverity,
    isTestFile,
} from '../../../../src/application/analysis/clones-literals';
import {
    normalizeBody,
    sha256Hex,
} from '../../../../src/application/analysis/clones-normalize';

// EntityHash literal helper.
const eh = (
    entityId: string,
    fileId: string,
    normalizedHash: string,
    tokenCount: number,
): EntityHash => ({ entityId, fileId, normalizedHash, tokenCount, literalHashes: [] });

test('two functions identical modulo identifier/literal names ⇒ one cluster', () => {
    const bodyA = 'function f(){const x = 1; return g(x) + h(2, "a");}';
    const bodyB = 'function q(){const y = 2; return g(y) + h(7, "z");}';

    const nA = normalizeBody(bodyA);
    const nB = normalizeBody(bodyB);
    assert.equal(
        nA.text,
        nB.text,
        `Type-2 normalize should match; got\nA=${nA.text}\nB=${nB.text}`,
    );
    assert.ok(nA.tokenCount >= 20, `bodyA should clear the floor; got ${nA.tokenCount}`);

    const hash = sha256Hex(nA.text);
    assert.equal(hash, sha256Hex(nB.text), 'identical normalized text ⇒ identical hash');

    const entities = [
        eh('src/a.ts::f', 'src/a.ts', hash, nA.tokenCount),
        eh('src/b.ts::q', 'src/b.ts', hash, nB.tokenCount),
    ];
    const { findings, edges } = clusterClones(entities);

    assert.equal(findings.length, 1, 'exactly one clone cluster');
    assert.deepEqual(
        findings[0].members,
        ['src/a.ts::f', 'src/b.ts::q'],
        'both entity ids in members (sorted)',
    );
    assert.equal(findings[0].cloneType, 'exact-body');
    assert.equal(findings[0].similarity, 1);
    assert.equal(edges.length, 1, 'one chain edge between the two members');
    assert.equal(edges[0].source, 'src/a.ts::f');
    assert.equal(edges[0].target, 'src/b.ts::q');
    assert.equal(edges[0].kind, 'clone');
});

test('a <20-token entity is skipped (noise floor)', () => {
    // Two entities collide on hash but both are below the 20-token floor.
    const entities = [
        eh('src/a.ts::tiny1', 'src/a.ts', 'HASH_SMALL', 5),
        eh('src/b.ts::tiny2', 'src/b.ts', 'HASH_SMALL', 5),
    ];
    const { findings, edges } = clusterClones(entities);
    assert.equal(findings.length, 0, 'sub-floor entities are not clustered');
    assert.equal(edges.length, 0, 'no edges for skipped entities');
});

test('same-file pair ranks lower (low) than cross-layer pair (high)', () => {
    const entities = [
        // same-file cluster (one hash, both under src/a/x.ts) → low
        eh('src/a/x.ts::f', 'src/a/x.ts', 'HASH_SAMEFILE', 30),
        eh('src/a/x.ts::g', 'src/a/x.ts', 'HASH_SAMEFILE', 30),
        // cross-layer cluster (cli vs webview top-level modules) → high
        eh('src/cli/x.ts::f', 'src/cli/x.ts', 'HASH_CROSS', 30),
        eh('src/webview/y.ts::g', 'src/webview/y.ts', 'HASH_CROSS', 30),
    ];
    const { findings } = clusterClones(entities);
    assert.equal(findings.length, 2, 'two clusters');

    const sameFile = findings.find(f =>
        f.members.every(m => m.startsWith('src/a/x.ts::')),
    );
    const crossLayer = findings.find(f =>
        f.members.some(m => m.startsWith('src/cli/')),
    );
    assert.ok(sameFile && crossLayer, 'both clusters present');
    assert.equal(sameFile!.severity, 'low', 'same-file cluster is low');
    assert.equal(crossLayer!.severity, 'high', 'cross-layer cluster is high');

    // Explicit "ranks lower" assertion.
    const rank = { high: 3, medium: 2, low: 1 } as const;
    assert.ok(
        rank[sameFile!.severity] < rank[crossLayer!.severity],
        'same-file ranks lower than cross-layer',
    );
});

// A4 (2026-07-13): severity distance is measured over NON-TEST files only —
// a src file mirrored by its own test must not earn cross-layer `high`.
test('isTestFile: tests/ prefix, __tests__/, .test./.spec. segments', () => {
    assert.equal(isTestFile('tests/unit/core/ids.test.ts'), true);
    assert.equal(isTestFile('packages/x/tests/helper.ts'), true);
    assert.equal(isTestFile('src/__tests__/x.ts'), true);
    assert.equal(isTestFile('src/foo.test.ts'), true);
    assert.equal(isTestFile('src/foo.spec.tsx'), true);
    assert.equal(isTestFile('src/application/clones.ts'), false);
    assert.equal(isTestFile('src/testing-utils.ts'), false, 'name containing "test" is not a test file');
});

test('clusterSeverity: test members never raise severity', () => {
    const eh2 = (entityId: string, fileId: string): EntityHash =>
        ({ entityId, fileId, normalizedHash: 'H', tokenCount: 30, literalHashes: [] });

    // src + its own test mirror → low (was high: src vs tests span modules).
    assert.equal(
        clusterSeverity([
            eh2('src/graph/scc.ts::f', 'src/graph/scc.ts'),
            eh2('tests/unit/graph/scc.test.ts::f', 'tests/unit/graph/scc.test.ts'),
        ]),
        'low',
    );

    // two src files, same module (+ a test member) → medium.
    assert.equal(
        clusterSeverity([
            eh2('src/graph/a.ts::f', 'src/graph/a.ts'),
            eh2('src/graph/b.ts::g', 'src/graph/b.ts'),
            eh2('tests/unit/graph/a.test.ts::f', 'tests/unit/graph/a.test.ts'),
        ]),
        'medium',
    );

    // two src files across modules (+ a test member) → still high.
    assert.equal(
        clusterSeverity([
            eh2('src/cli/x.ts::f', 'src/cli/x.ts'),
            eh2('src/webview/y.ts::g', 'src/webview/y.ts'),
            eh2('tests/unit/cli/x.test.ts::f', 'tests/unit/cli/x.test.ts'),
        ]),
        'high',
    );

    // all-test cluster → low.
    assert.equal(
        clusterSeverity([
            eh2('tests/unit/a.test.ts::f', 'tests/unit/a.test.ts'),
            eh2('tests/integration/b.test.ts::g', 'tests/integration/b.test.ts'),
        ]),
        'low',
    );
});
