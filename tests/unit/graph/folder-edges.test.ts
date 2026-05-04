// tests/unit/graph/folder-edges.test.ts
//
// Loop 08 — pin the folder-edges aggregator contract.

import test from 'node:test';
import assert from 'node:assert/strict';

import { isExternalModuleId } from '../../../src/core/ids';
import {
    FolderEdgelistLoadError,
    buildFolderEdges,
    migrateFolderEdges,
    type BuildFolderEdgesInput,
    type FolderEdge,
} from '../../../src/graph/folder-edges';

const FILE = '/test/path/folder-edges.json';

const identityFileOf = (id: string): string | null => id;
const externalAwareFileOf = (id: string): string | null =>
    isExternalModuleId(id) ? null : id;
const beforeDoubleColon = (id: string): string | null => {
    const idx = id.indexOf('::');
    const base = idx >= 0 ? id.slice(0, idx) : id;
    return isExternalModuleId(base) ? null : base;
};

test('folder-edges: empty input yields empty edges and weightP90 = 0', () => {
    const result = buildFolderEdges({
        importEdges: [],
        callEdges: [],
        fileOf: identityFileOf,
    });
    assert.equal(result.schemaVersion, 1);
    assert.equal(typeof result.timestamp, 'string');
    assert.deepEqual(result.edges, []);
    assert.equal(result.weightP90, 0);
});

test('folder-edges: internal edges aggregate to a single weighted folder edge', () => {
    const result = buildFolderEdges({
        importEdges: [
            { source: 'src/parser/a.ts', target: 'src/graph/types.ts' },
            { source: 'src/parser/b.ts', target: 'src/graph/types.ts' },
            { source: 'src/parser/c.ts', target: 'src/graph/edgelist.ts' },
        ],
        callEdges: [],
        fileOf: identityFileOf,
    });
    assert.equal(result.edges.length, 1);
    const e = result.edges[0];
    assert.equal(e.from, 'src/parser');
    assert.equal(e.to, 'src/graph');
    assert.equal(e.kind, 'import');
    assert.equal(e.weight, 3);
});

test('folder-edges: self-edges are dropped', () => {
    const result = buildFolderEdges({
        importEdges: [
            { source: 'src/parser/a.ts', target: 'src/parser/b.ts' },
            { source: 'src/parser/c.ts', target: 'src/parser/d.ts' },
        ],
        callEdges: [],
        fileOf: identityFileOf,
    });
    assert.deepEqual(result.edges, []);
});

test('folder-edges: external endpoints are dropped via fileOf returning null', () => {
    const result = buildFolderEdges({
        importEdges: [
            { source: 'src/parser/a.ts', target: 'react' },
            { source: 'src/parser/a.ts', target: 'src/graph/types.ts' },
        ],
        callEdges: [],
        fileOf: externalAwareFileOf,
    });
    assert.equal(result.edges.length, 1);
    assert.equal(result.edges[0].to, 'src/graph');
});

test('folder-edges: same folder pair, two kinds, two distinct rows', () => {
    const result = buildFolderEdges({
        importEdges: [
            { source: 'src/parser/a.ts', target: 'src/graph/types.ts' },
        ],
        callEdges: [
            { source: 'src/parser/a.ts::foo', target: 'src/graph/types.ts::bar' },
        ],
        fileOf: beforeDoubleColon,
    });
    assert.equal(result.edges.length, 2);
    const kinds = result.edges.map((e: FolderEdge) => e.kind).sort();
    assert.deepEqual(kinds, ['call', 'import']);
    for (const e of result.edges) {
        assert.equal(e.from, 'src/parser');
        assert.equal(e.to, 'src/graph');
        assert.equal(e.weight, 1);
    }
});

test('folder-edges: call edges resolve via fileOf (entity → file)', () => {
    const result = buildFolderEdges({
        importEdges: [],
        callEdges: [
            { source: 'src/parser/a.ts::foo', target: 'src/graph/types.ts::bar' },
        ],
        fileOf: beforeDoubleColon,
    });
    assert.equal(result.edges.length, 1);
    assert.equal(result.edges[0].kind, 'call');
    assert.equal(result.edges[0].from, 'src/parser');
    assert.equal(result.edges[0].to, 'src/graph');
});

test('folder-edges: top-level file produces a "." → "src" folder edge', () => {
    const result = buildFolderEdges({
        importEdges: [{ source: 'foo.ts', target: 'src/x.ts' }],
        callEdges: [],
        fileOf: identityFileOf,
    });
    assert.equal(result.edges.length, 1);
    assert.equal(result.edges[0].from, '.');
    assert.equal(result.edges[0].to, 'src');
});

test('folder-edges: Windows-style file IDs normalize to forward-slash folders', () => {
    const input: BuildFolderEdgesInput = {
        importEdges: [
            { source: 'src\\parser\\a.ts', target: 'src\\graph\\types.ts' },
            { source: 'src\\parser\\b.ts', target: 'src\\graph\\types.ts' },
        ],
        callEdges: [],
        fileOf: identityFileOf,
    };
    const result = buildFolderEdges(input);
    assert.equal(result.edges.length, 1);
    const e = result.edges[0];
    assert.equal(e.from, 'src/parser');
    assert.equal(e.to, 'src/graph');
    assert.equal(e.weight, 2);
});

test('folder-edges: deterministic — building twice yields deepEqual results', () => {
    const input: BuildFolderEdgesInput = {
        importEdges: [
            { source: 'src/parser/a.ts', target: 'src/graph/types.ts' },
            { source: 'src/parser/a.ts', target: 'src/info/x.ts' },
            { source: 'src/info/y.ts', target: 'src/graph/types.ts' },
        ],
        callEdges: [
            { source: 'src/parser/a.ts::foo', target: 'src/graph/types.ts::bar' },
        ],
        fileOf: beforeDoubleColon,
    };
    const a = buildFolderEdges(input);
    const b = buildFolderEdges(input);
    assert.deepEqual(a.edges, b.edges);
});

test('folder-edges: weightP90 is populated on the envelope', () => {
    const importEdges: { source: string; target: string }[] = [];
    // Build 10 distinct folder pairs with weights 1..10.
    for (let i = 1; i <= 10; i++) {
        for (let j = 0; j < i; j++) {
            importEdges.push({
                source: `src/from${i}/file${j}.ts`,
                target: `src/to${i}/file.ts`,
            });
        }
    }
    const result = buildFolderEdges({
        importEdges,
        callEdges: [],
        fileOf: identityFileOf,
    });
    assert.equal(result.edges.length, 10);
    const weights = result.edges.map((e) => e.weight).sort((a, b) => a - b);
    assert.deepEqual(weights, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // rank = 0.9 * 9 = 8.1; sorted[8] + 0.1 * (sorted[9] - sorted[8]) = 9 + 0.1
    assert.ok(Math.abs(result.weightP90 - 9.1) < 1e-9, `weightP90 was ${result.weightP90}`);
});

test('folder-edges: migrateFolderEdges accepts versionless and schemaVersion 1', () => {
    const versionless = {
        timestamp: '2026-01-01T00:00:00.000Z',
        edges: [],
        weightP90: 0,
    };
    const v1 = {
        schemaVersion: 1,
        timestamp: '2026-01-01T00:00:00.000Z',
        edges: [{ from: 'a', to: 'b', kind: 'import', weight: 2 }],
        weightP90: 2,
    };
    assert.equal(migrateFolderEdges(versionless, FILE).schemaVersion, 1);
    const parsed = migrateFolderEdges(v1, FILE);
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.edges.length, 1);
});

test('folder-edges: migrateFolderEdges rejects schemaVersion 2 with FolderEdgelistLoadError', () => {
    const future = {
        schemaVersion: 2,
        timestamp: '2026-01-01T00:00:00.000Z',
        edges: [],
        weightP90: 0,
    };
    let caught: FolderEdgelistLoadError | undefined;
    try {
        migrateFolderEdges(future, FILE);
    } catch (e) {
        caught = e as FolderEdgelistLoadError;
    }
    assert.ok(caught, 'expected FolderEdgelistLoadError');
    assert.equal(caught!.reason, 'unknown-version');
    assert.equal(caught!.filePath, FILE);
});

test('folder-edges: migrateFolderEdges rejects malformed payloads with schema-error', () => {
    const bad = {
        schemaVersion: 1,
        timestamp: '2026-01-01T00:00:00.000Z',
        edges: [{ from: 'a', to: 'b', kind: 'wat', weight: 1 }],
        weightP90: 0,
    };
    let caught: FolderEdgelistLoadError | undefined;
    try {
        migrateFolderEdges(bad, FILE);
    } catch (e) {
        caught = e as FolderEdgelistLoadError;
    }
    assert.ok(caught, 'expected FolderEdgelistLoadError');
    assert.equal(caught!.reason, 'schema-error');
});
