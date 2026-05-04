// tests/unit/graph/folder-tree.test.ts
//
// Loop 08 — pin the folder-tree aggregator contract.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    FOLDER_TREE_SCHEMA_VERSION,
    FolderTreeLoadError,
    FolderTreeSchema,
    buildFolderTree,
    migrateFolderTree,
    type FolderNode,
} from '../../../src/graph/folder-tree';

const FILE = '/test/path/folder-tree.json';

function findChild(node: FolderNode, name: string): FolderNode | undefined {
    return node.children.find((c) => c.name === name);
}

test('folder-tree: empty input yields a bare root', () => {
    const result = buildFolderTree({
        importNodes: [],
        documentedFolders: new Set<string>(),
    });
    assert.equal(result.schemaVersion, FOLDER_TREE_SCHEMA_VERSION);
    assert.equal(typeof result.timestamp, 'string');
    assert.equal(result.root.path, '');
    assert.equal(result.root.name, '');
    assert.equal(result.root.fileCount, 0);
    assert.equal(result.root.totalLOC, 0);
    assert.equal(result.root.documented, false);
    assert.deepEqual(result.root.children, []);
});

test('folder-tree: single top-level file lands in a "." child', () => {
    const result = buildFolderTree({
        importNodes: [{ id: 'foo.ts', loc: 42 }],
        documentedFolders: new Set<string>(),
    });
    assert.equal(result.root.fileCount, 1);
    assert.equal(result.root.totalLOC, 42);
    assert.equal(result.root.children.length, 1);
    const dot = result.root.children[0];
    assert.equal(dot.path, '.');
    assert.equal(dot.name, '.');
    assert.equal(dot.fileCount, 1);
    assert.equal(dot.totalLOC, 42);
    assert.equal(dot.documented, false);
    assert.deepEqual(dot.children, []);
});

test('folder-tree: nested tree aggregates counts and LOC, sorts alphabetically', () => {
    const result = buildFolderTree({
        importNodes: [
            { id: 'src/parser/ts-extractor.ts', loc: 100 },
            { id: 'src/parser/ts-service.ts', loc: 200 },
            { id: 'src/graph/types.ts', loc: 50 },
            { id: 'src/graph/edgelist.ts', loc: 300 },
        ],
        documentedFolders: new Set(['src/parser']),
    });

    assert.equal(result.root.fileCount, 4);
    assert.equal(result.root.totalLOC, 650);
    assert.equal(result.root.children.length, 1);

    const src = result.root.children[0];
    assert.equal(src.path, 'src');
    assert.equal(src.name, 'src');
    assert.equal(src.fileCount, 4);
    assert.equal(src.totalLOC, 650);
    assert.equal(src.documented, false);
    assert.equal(src.children.length, 2);

    // Alphabetical: graph before parser.
    assert.equal(src.children[0].name, 'graph');
    assert.equal(src.children[1].name, 'parser');

    const graph = src.children[0];
    assert.equal(graph.path, 'src/graph');
    assert.equal(graph.fileCount, 2);
    assert.equal(graph.totalLOC, 350);
    assert.equal(graph.documented, false);

    const parser = src.children[1];
    assert.equal(parser.path, 'src/parser');
    assert.equal(parser.fileCount, 2);
    assert.equal(parser.totalLOC, 300);
    assert.equal(parser.documented, true);
});

test('folder-tree: external module IDs are dropped', () => {
    const result = buildFolderTree({
        importNodes: [
            { id: 'src/x.ts', loc: 10 },
            { id: 'react' },
            { id: 'pathlib' },
        ],
        documentedFolders: new Set<string>(),
    });
    assert.equal(result.root.fileCount, 1);
    assert.equal(result.root.totalLOC, 10);
    assert.equal(result.root.children.length, 1);
    assert.equal(result.root.children[0].name, 'src');
});

test('folder-tree: Windows-style file IDs normalize to forward slashes', () => {
    const result = buildFolderTree({
        importNodes: [
            { id: 'src\\parser\\ts-extractor.ts', loc: 100 },
            { id: 'src\\parser\\ts-service.ts', loc: 200 },
        ],
        documentedFolders: new Set<string>(),
    });
    assert.equal(result.root.fileCount, 2);
    const src = findChild(result.root, 'src');
    assert.ok(src, 'expected src child');
    const parser = findChild(src!, 'parser');
    assert.ok(parser, 'expected src/parser child (not "src\\parser")');
    assert.equal(parser!.path, 'src/parser');
    assert.equal(parser!.fileCount, 2);
    assert.equal(parser!.totalLOC, 300);
    // No backslash-named folder snuck in.
    assert.equal(findChild(result.root, 'src\\parser'), undefined);
});

test('folder-tree: missing loc treated as 0', () => {
    const result = buildFolderTree({
        importNodes: [{ id: 'src/x.ts' }],
        documentedFolders: new Set<string>(),
    });
    assert.equal(result.root.totalLOC, 0);
    const src = findChild(result.root, 'src');
    assert.equal(src!.totalLOC, 0);
    assert.equal(src!.fileCount, 1);
});

test('folder-tree: schema round-trip via FolderTreeSchema.parse', () => {
    const tree = buildFolderTree({
        importNodes: [
            { id: 'src/a.ts', loc: 1 },
            { id: 'src/sub/b.ts', loc: 2 },
        ],
        documentedFolders: new Set(['src']),
    });
    // Round through JSON to drop any function/symbol traces.
    const serialized = JSON.parse(JSON.stringify(tree));
    const parsed = FolderTreeSchema.parse(serialized);
    assert.equal(parsed.root.fileCount, 2);
});

test('folder-tree: migrateFolderTree accepts versionless documents as v1', () => {
    const versionless = {
        timestamp: '2026-01-01T00:00:00.000Z',
        root: {
            path: '',
            name: '',
            fileCount: 0,
            totalLOC: 0,
            documented: false,
            children: [],
        },
    };
    const result = migrateFolderTree(versionless, FILE);
    assert.equal(result.schemaVersion, 1);
});

test('folder-tree: migrateFolderTree accepts schemaVersion 1 documents', () => {
    const v1 = {
        schemaVersion: 1,
        timestamp: '2026-01-01T00:00:00.000Z',
        root: {
            path: '',
            name: '',
            fileCount: 0,
            totalLOC: 0,
            documented: false,
            children: [],
        },
    };
    const result = migrateFolderTree(v1, FILE);
    assert.equal(result.schemaVersion, 1);
});

test('folder-tree: migrateFolderTree rejects schemaVersion 2 with FolderTreeLoadError', () => {
    const future = {
        schemaVersion: 2,
        timestamp: '2026-01-01T00:00:00.000Z',
        root: {
            path: '',
            name: '',
            fileCount: 0,
            totalLOC: 0,
            documented: false,
            children: [],
        },
    };
    let caught: FolderTreeLoadError | undefined;
    try {
        migrateFolderTree(future, FILE);
    } catch (e) {
        caught = e as FolderTreeLoadError;
    }
    assert.ok(caught, 'expected FolderTreeLoadError');
    assert.equal(caught!.reason, 'unknown-version');
    assert.equal(caught!.filePath, FILE);
    assert.match(caught!.message, /2/);
});

test('folder-tree: migrateFolderTree rejects scalars and arrays with schema-error', () => {
    for (const bad of [null, undefined, 42, 'string', true, [1, 2, 3]]) {
        let caught: FolderTreeLoadError | undefined;
        try {
            migrateFolderTree(bad, FILE);
        } catch (e) {
            caught = e as FolderTreeLoadError;
        }
        assert.ok(caught, `expected FolderTreeLoadError for ${String(bad)}`);
        assert.equal(caught!.reason, 'schema-error');
    }
});
