// tests/unit/application/analysis/clones-literal.test.ts
//
// Loop 07 — pure-function tests for the shared-literal (Tier 1.5) analyzer.
// Hermetic: drives `extractLiteralHashes` + `clusterSharedLiterals` directly
// (no IO, no parse, no ctx), mirroring the two VERIFIED real-repo duplicates so
// the unit suite proves the exact real findings the spec demanded.
//
// Verified real-repo targets (copied VERBATIM):
//   1. `markers` array — byte-identical at src/mcp/main.ts:48 and
//      src/workspace/detect.ts:49 → cross-layer → HIGH shared-literal (array).
//   2. `replace(/\\/g, '/')` POSIX-normalize idiom — pervasive (73 files) →
//      asserted FOUND (high recall), ranked low, NEVER filtered.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    extractLiteralHashes,
    clusterSharedLiterals,
    type EntityHash,
} from '../../../../src/application/analysis/clones-literals';

// EntityHash from a body: extract its literal hashes (mirrors findClones' MISS branch).
const ehFromBody = (entityId: string, fileId: string, body: string): EntityHash => ({
    entityId,
    fileId,
    normalizedHash: 'n/a', // shared-literal bucketing ignores the body hash
    tokenCount: 999, // above the floor (irrelevant to clusterSharedLiterals)
    literalHashes: extractLiteralHashes(body),
});

test('extractLiteralHashes: markers array + regex idiom yield kind-prefixed hashes', () => {
    const markers =
        "const markers = ['.git', 'package.json', '.llmem', '.arch', '.artifacts'];";
    const arrHashes = extractLiteralHashes(markers);
    assert.ok(
        arrHashes.some(h => h.startsWith('arr:')),
        `markers should yield an arr: payload; got ${arrHashes.join(', ')}`,
    );

    const regexIdiom = "return path.relative(root, abs).replace(/\\\\/g, '/');";
    const reHashes = extractLiteralHashes(regexIdiom);
    assert.ok(
        reHashes.some(h => h.startsWith('re:')),
        `regex idiom should yield a re: payload; got ${reHashes.join(', ')}`,
    );
});

test('markers array duplicated across layers ⇒ ONE high-severity shared-literal cluster', () => {
    const markersBody = (extra: string) =>
        `function f(){const markers = ['.git', 'package.json', '.llmem', '.arch', '.artifacts'];${extra} return markers;}`;

    const entities = [
        ehFromBody('src/mcp/main.ts::detectWorkspaceRoot', 'src/mcp/main.ts', markersBody(' const a = 1;')),
        ehFromBody('src/workspace/detect.ts::detectWorkspace', 'src/workspace/detect.ts', markersBody(' const b = 2;')),
    ];

    const { findings } = clusterSharedLiterals(entities);

    const arrayClusters = findings.filter(f => f.sharedKind === 'array');
    assert.equal(arrayClusters.length, 1, 'exactly one shared-array cluster for markers');
    const cluster = arrayClusters[0];
    assert.equal(cluster.cloneType, 'shared-literal');
    assert.equal(cluster.severity, 'high', 'cross-layer (src/mcp vs src/workspace) ⇒ high');
    assert.deepEqual(
        cluster.members,
        ['src/mcp/main.ts::detectWorkspaceRoot', 'src/workspace/detect.ts::detectWorkspace'],
        'both entity ids in members (sorted)',
    );
});

test('replace(/\\/g,"/") regex idiom across 3 functions ⇒ FOUND (recall-first), not filtered', () => {
    const idiomBody = (n: string) =>
        `function ${n}(p){ return path.relative(r, p).replace(/\\\\/g, '/'); }`;

    const entities = [
        ehFromBody('src/application/analysis/cache.ts::cacheDirRel', 'src/application/analysis/cache.ts', idiomBody('cacheDirRel')),
        ehFromBody('src/application/analysis/cache.ts::cacheRelPath', 'src/application/analysis/cache.ts', idiomBody('cacheRelPath')),
        ehFromBody('src/webview/data-service.ts::rel', 'src/webview/data-service.ts', idiomBody('rel')),
    ];

    const { findings } = clusterSharedLiterals(entities);

    const regexClusters = findings.filter(f => f.sharedKind === 'regex');
    assert.equal(regexClusters.length, 1, 'the pervasive regex idiom is ONE cluster (FOUND, not dropped)');
    const cluster = regexClusters[0];
    assert.equal(cluster.cloneType, 'shared-literal');
    assert.equal(cluster.members.length, 3, 'all 3 sharing entities present (high recall)');
});

test('noise floor: single-char string + single-element array produce NO cluster', () => {
    const tinyBody = (n: string) => `function ${n}(){ const c = 'a'; const arr = ['only']; return c + arr; }`;

    const entities = [
        ehFromBody('src/a.ts::p', 'src/a.ts', tinyBody('p')),
        ehFromBody('src/b.ts::q', 'src/b.ts', tinyBody('q')),
    ];

    // 'a' is single-char (floor: skip), ['only'] is single-element (floor: skip),
    // and 'only' as a string element is shared but it is the array's lone scalar —
    // it IS emitted as a str: payload (recall-first). So we assert specifically
    // that there is NO array cluster and NO single-char string cluster.
    const { findings } = clusterSharedLiterals(entities);
    assert.ok(
        findings.every(f => f.sharedKind !== 'array'),
        'single-element array must not form an array cluster (floor)',
    );
    // The single-char 'a' must not appear as a shared string cluster.
    const aHashes = extractLiteralHashes("const c = 'a';");
    assert.equal(aHashes.length, 0, "single-char string 'a' is below the floor (no hash)");
});
