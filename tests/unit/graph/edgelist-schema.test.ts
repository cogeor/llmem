// tests/unit/graph/edgelist-schema.test.ts
//
// Loop 16 — pin the persisted edge-list schema and the migrator's contract.
// The migrator is the gate between disk and memory: every malformed
// payload must produce an actionable EdgeListLoadError instead of the
// pre-Loop-16 silent reset.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    EDGELIST_SCHEMA_VERSION,
    EdgeListLoadError,
    createEmptyEdgeList,
    loadEdgeListData,
} from '../../../src/graph/edgelist-schema';

const FILE = '/test/path/edgelist.json';

test('edgelist-schema: createEmptyEdgeList round-trips through loadEdgeListData', () => {
    const empty = createEmptyEdgeList();
    const round = loadEdgeListData(JSON.parse(JSON.stringify(empty)), FILE);
    assert.equal(round.schemaVersion, 1);
    assert.equal(EDGELIST_SCHEMA_VERSION, 1);
    assert.deepEqual(round.nodes, []);
    assert.deepEqual(round.edges, []);
});

test('edgelist-schema: legacy v1.0.0 documents are accepted and rewritten to schemaVersion 1', () => {
    const legacy = {
        version: '1.0.0',
        timestamp: '2026-01-01T00:00:00.000Z',
        nodes: [],
        edges: [],
    };
    const result = loadEdgeListData(legacy, FILE);
    assert.equal(result.schemaVersion, 1);
    // legacy `version` field must NOT survive the migration
    assert.equal((result as Record<string, unknown>).version, undefined);
});

test('edgelist-schema: versionless documents are accepted as v1', () => {
    const versionless = {
        timestamp: '2026-01-01T00:00:00.000Z',
        nodes: [],
        edges: [],
    };
    const result = loadEdgeListData(versionless, FILE);
    assert.equal(result.schemaVersion, 1);
});

test('edgelist-schema: unknown schemaVersion is rejected with reason "unknown-version"', () => {
    const bad = {
        schemaVersion: 99,
        timestamp: '2026-01-01T00:00:00.000Z',
        nodes: [],
        edges: [],
    };
    let caught: EdgeListLoadError | undefined;
    try {
        loadEdgeListData(bad, FILE);
    } catch (e) {
        caught = e as EdgeListLoadError;
    }
    assert.ok(caught, 'expected EdgeListLoadError');
    assert.equal(caught!.reason, 'unknown-version');
    assert.equal(caught!.filePath, FILE);
    assert.match(caught!.message, /99/);
});

test('edgelist-schema: nodes-as-string is rejected with reason "schema-error" and field path', () => {
    const bad = {
        schemaVersion: 1,
        timestamp: '2026-01-01T00:00:00.000Z',
        nodes: 'banana',
        edges: [],
    };
    let caught: EdgeListLoadError | undefined;
    try {
        loadEdgeListData(bad, FILE);
    } catch (e) {
        caught = e as EdgeListLoadError;
    }
    assert.ok(caught, 'expected EdgeListLoadError');
    assert.equal(caught!.reason, 'schema-error');
    assert.match(caught!.detail, /nodes/);
});

test('edgelist-schema: edge with empty source is rejected with field path edges.0.source', () => {
    const bad = {
        schemaVersion: 1,
        timestamp: '2026-01-01T00:00:00.000Z',
        nodes: [],
        edges: [{ source: '', target: 'a', kind: 'import' }],
    };
    let caught: EdgeListLoadError | undefined;
    try {
        loadEdgeListData(bad, FILE);
    } catch (e) {
        caught = e as EdgeListLoadError;
    }
    assert.ok(caught, 'expected EdgeListLoadError');
    assert.equal(caught!.reason, 'schema-error');
    assert.match(caught!.detail, /edges\.0\.source/);
});

test('edgelist-schema: scalar/null inputs are rejected with reason "schema-error"', () => {
    for (const bad of [null, undefined, 42, 'string', true]) {
        let caught: EdgeListLoadError | undefined;
        try {
            loadEdgeListData(bad, FILE);
        } catch (e) {
            caught = e as EdgeListLoadError;
        }
        assert.ok(caught, `expected EdgeListLoadError for ${String(bad)}`);
        assert.equal(caught!.reason, 'schema-error');
    }
});

test('edgelist-schema: array inputs are rejected with reason "schema-error"', () => {
    let caught: EdgeListLoadError | undefined;
    try {
        loadEdgeListData([1, 2, 3], FILE);
    } catch (e) {
        caught = e as EdgeListLoadError;
    }
    assert.ok(caught, 'expected EdgeListLoadError');
    assert.equal(caught!.reason, 'schema-error');
});

test('edgelist-schema: EdgeListLoadError carries the file path it was constructed with', () => {
    const filePath = '/some/specific/file.json';
    let caught: EdgeListLoadError | undefined;
    try {
        loadEdgeListData(null, filePath);
    } catch (e) {
        caught = e as EdgeListLoadError;
    }
    assert.ok(caught);
    assert.equal(caught!.filePath, filePath);
    assert.match(caught!.message, /\/some\/specific\/file\.json/);
});

test('edgelist-schema: kind enum rejects unknown node kinds', () => {
    const bad = {
        schemaVersion: 1,
        timestamp: '',
        nodes: [{ id: 'src/a.ts', name: 'a', kind: 'external', fileId: 'src/a.ts' }],
        edges: [],
    };
    let caught: EdgeListLoadError | undefined;
    try {
        loadEdgeListData(bad, FILE);
    } catch (e) {
        caught = e as EdgeListLoadError;
    }
    assert.ok(caught, 'expected EdgeListLoadError — persisted shape stays homogenous (no "external" kind)');
    assert.equal(caught!.reason, 'schema-error');
    assert.match(caught!.detail, /nodes\.0\.kind/);
});
