// tests/unit/graph/edgelist-schema-migration.test.ts
//
// Loop 13 (codebase-quality-v2) — pin the load-throws-SchemaMismatchError-then-
// rescan-writes-v_next behavior so a future regression is caught at the
// unit-test boundary rather than via a manual smoke check.
//
// The four sub-tests below cover the four legs of the migration contract:
//   1. v1-shaped fixture (no resolverVersion)             → SchemaMismatchError
//   2. v2 shape with stale resolverVersion string         → SchemaMismatchError
//   3. createEmptyEdgeList() round-trips through loadEdgeListData
//   4. End-to-end: drop a v_prev fixture into a tmp artifact dir, point
//      ImportEdgeListStore at it, observe the throw, then call clear() +
//      save() and assert the on-disk file is now v_next.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    EDGELIST_SCHEMA_VERSION,
    EDGELIST_RESOLVER_VERSION,
    EdgeListLoadError,
    SchemaMismatchError,
    createEmptyEdgeList,
    loadEdgeListData,
} from '../../../src/graph/edgelist-schema';
import { ImportEdgeListStore } from '../../../src/graph/edgelist';
import { WorkspaceIO } from '../../../src/workspace/workspace-io';
import { asWorkspaceRoot } from '../../../src/core/paths';

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/graph/edgelist-v_prev');
const FIXTURE_FILE = path.join(FIXTURE_DIR, 'import-edgelist.json');
const FILE = '/test/path/edgelist.json';

test('edgelist-schema-migration: v1 fixture throws SchemaMismatchError', () => {
    const raw = JSON.parse(fs.readFileSync(FIXTURE_FILE, 'utf-8'));
    let caught: EdgeListLoadError | undefined;
    try {
        loadEdgeListData(raw, FIXTURE_FILE);
    } catch (e) {
        caught = e as EdgeListLoadError;
    }
    assert.ok(caught, 'expected an EdgeListLoadError');
    assert.ok(
        caught instanceof SchemaMismatchError,
        'expected SchemaMismatchError, not the plain parent',
    );
    assert.equal(caught!.reason, 'unknown-version');
    const mismatch = caught as SchemaMismatchError;
    assert.equal(mismatch.oldSchemaVersion, 1);
    assert.equal(mismatch.oldResolverVersion, null);
});

test('edgelist-schema-migration: v2 with stale resolverVersion throws SchemaMismatchError', () => {
    const stale = {
        schemaVersion: EDGELIST_SCHEMA_VERSION,
        resolverVersion: 'ts-resolveModuleName-v0',
        timestamp: '2026-01-01T00:00:00.000Z',
        nodes: [],
        edges: [],
    };
    let caught: EdgeListLoadError | undefined;
    try {
        loadEdgeListData(stale, FILE);
    } catch (e) {
        caught = e as EdgeListLoadError;
    }
    assert.ok(caught, 'expected an EdgeListLoadError');
    assert.ok(caught instanceof SchemaMismatchError);
    const mismatch = caught as SchemaMismatchError;
    assert.equal(mismatch.oldSchemaVersion, 2);
    assert.equal(mismatch.oldResolverVersion, 'ts-resolveModuleName-v0');
});

test('edgelist-schema-migration: v_next document round-trips with resolverVersion stamped', () => {
    const empty = createEmptyEdgeList();
    const round = loadEdgeListData(JSON.parse(JSON.stringify(empty)), FILE);
    assert.equal(round.schemaVersion, EDGELIST_SCHEMA_VERSION);
    assert.equal(round.resolverVersion, EDGELIST_RESOLVER_VERSION);
});

test('edgelist-schema-migration: end-to-end load-clear-save cycle on a v_prev artifact dir produces a v_next envelope', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-mig-'));
    try {
        // Drop the v_prev fixture into the tmp artifact dir as if a stale
        // production install had written it there.
        fs.writeFileSync(
            path.join(tmp, 'import-edgelist.json'),
            fs.readFileSync(FIXTURE_FILE, 'utf-8'),
        );

        const io = await WorkspaceIO.create(asWorkspaceRoot(tmp));
        const store = new ImportEdgeListStore(tmp, io);

        await assert.rejects(
            store.load(),
            (e: unknown) => e instanceof SchemaMismatchError,
        );

        // The contract: clear() + save() replaces the stale file with a
        // v_next envelope. This is what `rescanAfterSchemaMismatch`
        // (and the in-place clear path in scanFile/scanFolder) rely on.
        store.clear();
        await store.save();

        const after = JSON.parse(
            fs.readFileSync(path.join(tmp, 'import-edgelist.json'), 'utf-8'),
        );
        assert.equal(after.schemaVersion, EDGELIST_SCHEMA_VERSION);
        assert.equal(after.resolverVersion, EDGELIST_RESOLVER_VERSION);
        assert.deepEqual(after.nodes, []);
        assert.deepEqual(after.edges, []);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
