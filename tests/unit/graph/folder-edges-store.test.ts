// tests/unit/graph/folder-edges-store.test.ts
//
// Loop 09 — pin the FolderEdgelistStore round-trip contract on disk.
// Eight cases per PLAN.md task 3, mirroring folder-tree-store.test.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    FolderEdgelistStore,
    FOLDER_EDGELIST_FILENAME,
} from '../../../src/graph/folder-edges-store';
import {
    FOLDER_EDGES_SCHEMA_VERSION,
    FolderEdgelistLoadError,
    buildFolderEdges,
    type FolderEdgelistData,
} from '../../../src/graph/folder-edges';
import { WorkspaceIO } from '../../../src/workspace/workspace-io';
import { asWorkspaceRoot } from '../../../src/core/paths';

function mkTmp(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rm(p: string): void {
    fs.rmSync(p, { recursive: true, force: true });
}

const identityFileOf = (id: string): string | null => id;

/** Loop 08 internal-edges fixture, also referenced from PLAN.md task 3 §6. */
function makeFixture(): FolderEdgelistData {
    return buildFolderEdges({
        importEdges: [
            { source: 'src/parser/a.ts', target: 'src/graph/types.ts' },
            { source: 'src/parser/b.ts', target: 'src/graph/types.ts' },
            { source: 'src/parser/c.ts', target: 'src/graph/edgelist.ts' },
        ],
        callEdges: [],
        fileOf: identityFileOf,
    });
}

// ---------------------------------------------------------------------------
// 1. Round-trip with WorkspaceIO
// ---------------------------------------------------------------------------

test('FolderEdgelistStore: round-trip with WorkspaceIO preserves edges + weightP90', async () => {
    const parent = mkTmp('llmem-fes-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        const artifactDir = path.join(io.getRealRoot(), '.artifacts');
        const store = new FolderEdgelistStore(artifactDir, io);

        const data = makeFixture();
        await store.save(data);
        const loaded = await store.load();

        assert.equal(loaded.schemaVersion, FOLDER_EDGES_SCHEMA_VERSION);
        // NOTE: do NOT compare timestamp — `save` re-stamps it.
        assert.deepEqual(loaded.edges, data.edges);
        assert.equal(loaded.weightP90, data.weightP90);
        assert.equal(typeof loaded.timestamp, 'string');
        assert.ok(loaded.timestamp.length > 0);

        const expectedFile = path.join(artifactDir, FOLDER_EDGELIST_FILENAME);
        assert.ok(fs.existsSync(expectedFile), `expected ${expectedFile} to exist`);
    } finally {
        rm(parent);
    }
});

// ---------------------------------------------------------------------------
// 2. save() creates the artifact directory
// ---------------------------------------------------------------------------

test('FolderEdgelistStore: save() creates the artifact directory if missing', async () => {
    const parent = mkTmp('llmem-fes-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        const artifactDir = path.join(io.getRealRoot(), '.artifacts');
        assert.ok(!fs.existsSync(artifactDir));

        const store = new FolderEdgelistStore(artifactDir, io);
        await store.save(makeFixture());

        assert.ok(fs.existsSync(artifactDir), 'artifactDir should be created');
        assert.ok(
            fs.existsSync(path.join(artifactDir, FOLDER_EDGELIST_FILENAME)),
            'edgelist file should be created inside it',
        );
    } finally {
        rm(parent);
    }
});

// ---------------------------------------------------------------------------
// 3. load() on missing file → FolderEdgelistLoadError, reason 'parse-error'
// ---------------------------------------------------------------------------

test('FolderEdgelistStore: load() on missing file throws FolderEdgelistLoadError parse-error', async () => {
    const parent = mkTmp('llmem-fes-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        const artifactDir = path.join(io.getRealRoot(), '.artifacts');
        fs.mkdirSync(artifactDir);

        const store = new FolderEdgelistStore(artifactDir, io);
        await assert.rejects(
            store.load(),
            (err: Error) =>
                err instanceof FolderEdgelistLoadError &&
                err.reason === 'parse-error',
        );
    } finally {
        rm(parent);
    }
});

// ---------------------------------------------------------------------------
// 4. load() on malformed JSON → FolderEdgelistLoadError parse-error
// ---------------------------------------------------------------------------

test('FolderEdgelistStore: load() on malformed JSON throws FolderEdgelistLoadError parse-error', async () => {
    const parent = mkTmp('llmem-fes-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        const artifactDir = path.join(io.getRealRoot(), '.artifacts');
        fs.mkdirSync(artifactDir);
        fs.writeFileSync(
            path.join(artifactDir, FOLDER_EDGELIST_FILENAME),
            '{ this is not json',
        );

        const store = new FolderEdgelistStore(artifactDir, io);
        await assert.rejects(
            store.load(),
            (err: Error) =>
                err instanceof FolderEdgelistLoadError &&
                err.reason === 'parse-error',
        );
    } finally {
        rm(parent);
    }
});

// ---------------------------------------------------------------------------
// 5. load() on schema-mismatched JSON → FolderEdgelistLoadError schema-error
// ---------------------------------------------------------------------------

test('FolderEdgelistStore: load() on schema-mismatched JSON throws FolderEdgelistLoadError schema-error', async () => {
    const parent = mkTmp('llmem-fes-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        const artifactDir = path.join(io.getRealRoot(), '.artifacts');
        fs.mkdirSync(artifactDir);
        // weightP90 wrong type → schema rejection.
        fs.writeFileSync(
            path.join(artifactDir, FOLDER_EDGELIST_FILENAME),
            JSON.stringify({
                schemaVersion: 1,
                timestamp: '2026-01-01T00:00:00Z',
                edges: [],
                weightP90: 'oops',
            }),
        );

        const store = new FolderEdgelistStore(artifactDir, io);
        await assert.rejects(
            store.load(),
            (err: Error) =>
                err instanceof FolderEdgelistLoadError &&
                err.reason === 'schema-error',
        );
    } finally {
        rm(parent);
    }
});

// ---------------------------------------------------------------------------
// 6. Containment: writing outside artifactDir throws PATH_ESCAPE
// ---------------------------------------------------------------------------

test('FolderEdgelistStore: save() outside the workspace root throws PATH_ESCAPE', async () => {
    const parent = mkTmp('llmem-fes-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        const artifactDir = path.join(io.getRealRoot(), '..', 'evil');

        const store = new FolderEdgelistStore(artifactDir, io);
        await assert.rejects(
            store.save(makeFixture()),
            (err: Error & { code?: string }) => err.code === 'PATH_ESCAPE',
        );
    } finally {
        rm(parent);
    }
});

// ---------------------------------------------------------------------------
// 7. Back-compat: no-io constructor still works
// ---------------------------------------------------------------------------

test('FolderEdgelistStore: back-compat no-io constructor round-trips', async () => {
    const parent = mkTmp('llmem-fes-');
    try {
        const artifactDir = path.join(parent, '.artifacts');
        const store = new FolderEdgelistStore(artifactDir);
        const data = makeFixture();
        await store.save(data);
        const loaded = await store.load();

        assert.equal(loaded.schemaVersion, FOLDER_EDGES_SCHEMA_VERSION);
        assert.deepEqual(loaded.edges, data.edges);
        assert.equal(loaded.weightP90, data.weightP90);
        assert.ok(fs.existsSync(path.join(artifactDir, FOLDER_EDGELIST_FILENAME)));
    } finally {
        rm(parent);
    }
});

// ---------------------------------------------------------------------------
// 8. save() re-stamps schemaVersion
// ---------------------------------------------------------------------------

test('FolderEdgelistStore: save() re-stamps schemaVersion to the current constant', async () => {
    const parent = mkTmp('llmem-fes-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        const artifactDir = path.join(io.getRealRoot(), '.artifacts');
        const store = new FolderEdgelistStore(artifactDir, io);

        const data: FolderEdgelistData = {
            ...makeFixture(),
            schemaVersion: 1,
        };
        await store.save(data);

        const onDisk = JSON.parse(
            fs.readFileSync(
                path.join(artifactDir, FOLDER_EDGELIST_FILENAME),
                'utf-8',
            ),
        );
        assert.equal(onDisk.schemaVersion, FOLDER_EDGES_SCHEMA_VERSION);
    } finally {
        rm(parent);
    }
});
