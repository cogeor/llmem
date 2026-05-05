// tests/unit/graph/folder-tree-store.test.ts
//
// Loop 09 — pin the FolderTreeStore round-trip contract on disk.
// Seven cases per PLAN.md task 3: round-trip + missing/malformed/
// schema-mismatched/containment-escape rejections + schemaVersion re-stamping.
// (Loop 07 deleted the back-compat no-io constructor case along with the
// legacy fs.* fallback in the store itself.)

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    FolderTreeStore,
    FOLDER_TREE_FILENAME,
} from '../../../src/graph/folder-tree-store';
import {
    FOLDER_TREE_SCHEMA_VERSION,
    FolderTreeLoadError,
    buildFolderTree,
    type FolderTreeData,
} from '../../../src/graph/folder-tree';
import { WorkspaceIO } from '../../../src/workspace/workspace-io';
import { asWorkspaceRoot } from '../../../src/core/paths';

function mkTmp(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rm(p: string): void {
    fs.rmSync(p, { recursive: true, force: true });
}

/** Loop 08 nested-tree fixture, also referenced from PLAN.md task 3.1. */
function makeFixture(): FolderTreeData {
    return buildFolderTree({
        importNodes: [
            { id: 'src/parser/ts-extractor.ts', loc: 100 },
            { id: 'src/parser/ts-service.ts', loc: 200 },
            { id: 'src/graph/types.ts', loc: 50 },
            { id: 'src/graph/edgelist.ts', loc: 300 },
        ],
        documentedFolders: new Set(['src/parser']),
    });
}

// ---------------------------------------------------------------------------
// 1. Round-trip with WorkspaceIO
// ---------------------------------------------------------------------------

test('FolderTreeStore: round-trip with WorkspaceIO preserves root + schemaVersion', async () => {
    const parent = mkTmp('llmem-fts-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        const artifactDir = path.join(io.getRealRoot(), '.artifacts');
        const store = new FolderTreeStore(artifactDir, io);

        const data = makeFixture();
        await store.save(data);
        const loaded = await store.load();

        assert.equal(loaded.schemaVersion, FOLDER_TREE_SCHEMA_VERSION);
        // NOTE: do NOT compare timestamp — `save` re-stamps it.
        assert.deepEqual(loaded.root, data.root);
        assert.equal(typeof loaded.timestamp, 'string');
        assert.ok(loaded.timestamp.length > 0);

        // Verify the file actually landed at the documented path.
        const expectedFile = path.join(artifactDir, FOLDER_TREE_FILENAME);
        assert.ok(fs.existsSync(expectedFile), `expected ${expectedFile} to exist`);
    } finally {
        rm(parent);
    }
});

// ---------------------------------------------------------------------------
// 2. save() creates the artifact directory
// ---------------------------------------------------------------------------

test('FolderTreeStore: save() creates the artifact directory if missing', async () => {
    const parent = mkTmp('llmem-fts-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        const artifactDir = path.join(io.getRealRoot(), '.artifacts');
        // .artifacts does NOT exist yet.
        assert.ok(!fs.existsSync(artifactDir));

        const store = new FolderTreeStore(artifactDir, io);
        await store.save(makeFixture());

        assert.ok(fs.existsSync(artifactDir), 'artifactDir should be created');
        assert.ok(
            fs.existsSync(path.join(artifactDir, FOLDER_TREE_FILENAME)),
            'tree file should be created inside it',
        );
    } finally {
        rm(parent);
    }
});

// ---------------------------------------------------------------------------
// 3. load() on missing file → FolderTreeLoadError, reason 'parse-error'
// ---------------------------------------------------------------------------

test('FolderTreeStore: load() on missing file throws FolderTreeLoadError parse-error', async () => {
    const parent = mkTmp('llmem-fts-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        const artifactDir = path.join(io.getRealRoot(), '.artifacts');
        fs.mkdirSync(artifactDir);

        const store = new FolderTreeStore(artifactDir, io);
        await assert.rejects(
            store.load(),
            (err: Error) =>
                err instanceof FolderTreeLoadError &&
                err.reason === 'parse-error',
        );
    } finally {
        rm(parent);
    }
});

// ---------------------------------------------------------------------------
// 4. load() on malformed JSON → FolderTreeLoadError, reason 'parse-error'
// ---------------------------------------------------------------------------

test('FolderTreeStore: load() on malformed JSON throws FolderTreeLoadError parse-error', async () => {
    const parent = mkTmp('llmem-fts-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        const artifactDir = path.join(io.getRealRoot(), '.artifacts');
        fs.mkdirSync(artifactDir);
        // Bypass the store: write garbage directly.
        fs.writeFileSync(
            path.join(artifactDir, FOLDER_TREE_FILENAME),
            '{ this is not json',
        );

        const store = new FolderTreeStore(artifactDir, io);
        await assert.rejects(
            store.load(),
            (err: Error) =>
                err instanceof FolderTreeLoadError &&
                err.reason === 'parse-error',
        );
    } finally {
        rm(parent);
    }
});

// ---------------------------------------------------------------------------
// 5. load() on schema-mismatched JSON → FolderTreeLoadError schema-error
// ---------------------------------------------------------------------------

test('FolderTreeStore: load() on schema-mismatched JSON throws FolderTreeLoadError schema-error', async () => {
    const parent = mkTmp('llmem-fts-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        const artifactDir = path.join(io.getRealRoot(), '.artifacts');
        fs.mkdirSync(artifactDir);
        // Valid JSON, missing required `root` field.
        fs.writeFileSync(
            path.join(artifactDir, FOLDER_TREE_FILENAME),
            JSON.stringify({ schemaVersion: 1, timestamp: '2026-01-01T00:00:00Z' }),
        );

        const store = new FolderTreeStore(artifactDir, io);
        await assert.rejects(
            store.load(),
            (err: Error) =>
                err instanceof FolderTreeLoadError &&
                err.reason === 'schema-error',
        );
    } finally {
        rm(parent);
    }
});

// ---------------------------------------------------------------------------
// 6. Containment: writing outside artifactDir throws PATH_ESCAPE
// ---------------------------------------------------------------------------

test('FolderTreeStore: save() outside the workspace root throws PATH_ESCAPE', async () => {
    const parent = mkTmp('llmem-fts-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        // artifactDir escapes workspace via `..`.
        const artifactDir = path.join(io.getRealRoot(), '..', 'evil');

        const store = new FolderTreeStore(artifactDir, io);
        // The error class identity is internal to WorkspaceIO; assert on `code`
        // so the test does not depend on importing PathEscapeError directly
        // (matches the convention in tests/unit/workspace/workspace-io.test.ts).
        await assert.rejects(
            store.save(makeFixture()),
            (err: Error & { code?: string }) => err.code === 'PATH_ESCAPE',
        );
    } finally {
        rm(parent);
    }
});

// ---------------------------------------------------------------------------
// 7. save() re-stamps schemaVersion
// ---------------------------------------------------------------------------

test('FolderTreeStore: save() re-stamps schemaVersion to the current constant', async () => {
    const parent = mkTmp('llmem-fts-');
    try {
        const root = path.join(parent, 'workspace');
        fs.mkdirSync(root);
        const io = await WorkspaceIO.create(asWorkspaceRoot(root));
        const artifactDir = path.join(io.getRealRoot(), '.artifacts');
        const store = new FolderTreeStore(artifactDir, io);

        const data: FolderTreeData = {
            ...makeFixture(),
            schemaVersion: 1, // currently the only valid value
        };
        await store.save(data);

        const onDisk = JSON.parse(
            fs.readFileSync(
                path.join(artifactDir, FOLDER_TREE_FILENAME),
                'utf-8',
            ),
        );
        assert.equal(onDisk.schemaVersion, FOLDER_TREE_SCHEMA_VERSION);
    } finally {
        rm(parent);
    }
});
