// tests/unit/web-viewer/folder-view-model.test.ts
//
// Loop 15 — pin the contract for the pure helpers in
// `src/webview/ui/components/folderViewModel.ts`. These functions are
// DOM-free, so the tests are tiny and fast. The whole file should never
// import `jsdom` — that is the win the orchestrator wanted out of the
// view-model split (testable without a DOM harness).
//
// Coverage matches the bullets in PLAN.md Task 8.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';

import {
    folderOf,
    buildVisNodes,
    buildVisEdges,
    parseEdgeId,
    findFolderEdgeById,
    nonIncidentEdgeIds,
    readmeKeyCandidates,
    resolveReadmeDoc,
} from '../../../src/webview/ui/components/folderViewModel';

import {
    FOLDER_EDGES_SCHEMA_VERSION,
    type FolderEdgelistData,
} from '../../../src/graph/folder-edges';
import {
    FOLDER_TREE_SCHEMA_VERSION,
    type FolderNode,
    type FolderTreeData,
} from '../../../src/graph/folder-tree';
import type { DesignDoc } from '../../../src/webview/ui/types';

// ---------------------------------------------------------------------------
// folderOf — parity with src/graph/folder-edges.ts canonical impl.
// ---------------------------------------------------------------------------

test('folderOf: top-level file → "."', () => {
    assert.equal(folderOf('foo.ts'), '.');
});

test('folderOf: nested file → parent path', () => {
    assert.equal(folderOf('src/foo/bar.ts'), 'src/foo');
});

test('folderOf: backslash path is normalized to forward-slash', () => {
    assert.equal(folderOf('src\\foo\\bar.ts'), 'src/foo');
});

test('folderOf: parity vs path.posix.dirname for ten relative paths', () => {
    const fixtures = [
        'a.ts',
        'src/foo.ts',
        'src/parser/ts-extractor.ts',
        'src/graph/types.ts',
        'a/b/c/d.ts',
        'src\\webview\\ui\\foo.ts',
        'src/.dot/foo.ts',
        'top-level.tsx',
        'a/b.test.ts',
        'src/parser/util/inner.ts',
    ];
    for (const f of fixtures) {
        const canonical = path.posix.dirname(f.replaceAll('\\', '/'));
        assert.equal(
            folderOf(f),
            canonical,
            `folderOf(${JSON.stringify(f)}) must equal path.posix.dirname (${canonical})`,
        );
    }
});

// ---------------------------------------------------------------------------
// buildVisNodes
// ---------------------------------------------------------------------------

function makeRootWith(children: FolderNode[]): FolderNode {
    return { path: '', name: '', fileCount: 0, totalLOC: 0, documented: false, children };
}

test('buildVisNodes: synthetic empty root is skipped', () => {
    const child: FolderNode = {
        path: 'src',
        name: 'src',
        fileCount: 3,
        totalLOC: 10,
        documented: false,
        children: [],
    };
    const out = buildVisNodes(makeRootWith([child]));
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'src');
    assert.equal(out[0].label, 'src');
});

test('buildVisNodes: two-level tree → both nodes; titles include file count', () => {
    const tree: FolderNode = makeRootWith([
        {
            path: 'src',
            name: 'src',
            fileCount: 5,
            totalLOC: 100,
            documented: false,
            children: [
                {
                    path: 'src/parser',
                    name: 'parser',
                    fileCount: 2,
                    totalLOC: 40,
                    documented: false,
                    children: [],
                },
            ],
        },
    ]);
    const out = buildVisNodes(tree);
    assert.equal(out.length, 2);
    const byId = new Map(out.map((n) => [n.id, n] as const));
    assert.equal(byId.get('src')?.label, 'src');
    assert.equal(byId.get('src/parser')?.label, 'parser');
    assert.match(byId.get('src')?.title ?? '', /5 files/);
    assert.match(byId.get('src/parser')?.title ?? '', /2 files/);
});

// ---------------------------------------------------------------------------
// buildVisEdges
// ---------------------------------------------------------------------------

function makeEdgelist(
    edges: FolderEdgelistData['edges'],
    weightP90: number,
): FolderEdgelistData {
    return {
        schemaVersion: FOLDER_EDGES_SCHEMA_VERSION,
        timestamp: '2026-05-05T00:00:00.000Z',
        edges,
        weightP90,
    };
}

test('buildVisEdges: showAllEdges=false applies the weightP90 threshold', () => {
    const edgelist = makeEdgelist(
        [
            { from: 'a', to: 'b', kind: 'import', weight: 1 },
            { from: 'a', to: 'b', kind: 'call', weight: 5 },
            { from: 'b', to: 'a', kind: 'import', weight: 10 },
        ],
        5,
    );
    const out = buildVisEdges(edgelist, { showAllEdges: false });
    assert.equal(out.length, 2);
    const ids = new Set(out.map((e) => e.id));
    assert.ok(ids.has('call|a|b'));
    assert.ok(ids.has('import|b|a'));
    assert.ok(!ids.has('import|a|b'));
});

test('buildVisEdges: showAllEdges=true emits every edge', () => {
    const edgelist = makeEdgelist(
        [
            { from: 'a', to: 'b', kind: 'import', weight: 1 },
            { from: 'a', to: 'b', kind: 'call', weight: 5 },
            { from: 'b', to: 'a', kind: 'import', weight: 10 },
        ],
        5,
    );
    const out = buildVisEdges(edgelist, { showAllEdges: true });
    assert.equal(out.length, 3);
});

test('buildVisEdges: stable id format ${kind}|${from}|${to}', () => {
    const edgelist = makeEdgelist(
        [{ from: 'src/a', to: 'src/b', kind: 'import', weight: 1 }],
        0,
    );
    const out = buildVisEdges(edgelist, { showAllEdges: true });
    assert.equal(out[0].id, 'import|src/a|src/b');
});

test('buildVisEdges: kind→color palette is pinned (import blue, call orange)', () => {
    const edgelist = makeEdgelist(
        [
            { from: 'a', to: 'b', kind: 'import', weight: 1 },
            { from: 'a', to: 'b', kind: 'call', weight: 1 },
        ],
        0,
    );
    const out = buildVisEdges(edgelist, { showAllEdges: true });
    const byKind = Object.fromEntries(out.map((e) => [e.id.split('|')[0], e.color] as const));
    assert.equal(byKind['import'], '#5b8def', 'import edges must be #5b8def');
    assert.equal(byKind['call'], '#e8a23a', 'call edges must be #e8a23a');
});

// ---------------------------------------------------------------------------
// parseEdgeId
// ---------------------------------------------------------------------------

test('parseEdgeId: well-formed import id → kind/from/to triple', () => {
    assert.deepEqual(parseEdgeId('import|src/a|src/b'), {
        kind: 'import',
        from: 'src/a',
        to: 'src/b',
    });
});

test('parseEdgeId: well-formed call id', () => {
    assert.deepEqual(parseEdgeId('call|x|y'), { kind: 'call', from: 'x', to: 'y' });
});

test('parseEdgeId: malformed inputs return null', () => {
    assert.equal(parseEdgeId('a|b'), null, 'too few segments');
    assert.equal(parseEdgeId('a|b|c|d'), null, 'too many segments');
    assert.equal(parseEdgeId('unknown|x|y'), null, 'unknown kind');
    assert.equal(parseEdgeId(''), null, 'empty input');
});

// ---------------------------------------------------------------------------
// findFolderEdgeById
// ---------------------------------------------------------------------------

test('findFolderEdgeById: hit returns the underlying FolderEdge', () => {
    const edgelist = makeEdgelist(
        [
            { from: 'a', to: 'b', kind: 'import', weight: 5 },
            { from: 'b', to: 'a', kind: 'call', weight: 2 },
        ],
        0,
    );
    const found = findFolderEdgeById(edgelist, 'import|a|b');
    assert.deepEqual(found, { from: 'a', to: 'b', kind: 'import', weight: 5 });
});

test('findFolderEdgeById: miss returns null', () => {
    const edgelist = makeEdgelist(
        [{ from: 'a', to: 'b', kind: 'import', weight: 5 }],
        0,
    );
    assert.equal(findFolderEdgeById(edgelist, 'import|a|c'), null);
});

test('findFolderEdgeById: malformed id returns null', () => {
    const edgelist = makeEdgelist(
        [{ from: 'a', to: 'b', kind: 'import', weight: 5 }],
        0,
    );
    assert.equal(findFolderEdgeById(edgelist, 'not|an|edge|id'), null);
    assert.equal(findFolderEdgeById(edgelist, 'rubbish'), null);
});

// ---------------------------------------------------------------------------
// nonIncidentEdgeIds
// ---------------------------------------------------------------------------

test('nonIncidentEdgeIds: returns only ids whose endpoints exclude the hovered folder', () => {
    const ids = ['import|src/a|src/b', 'import|src/c|src/d', 'call|src/a|src/e'];
    assert.deepEqual(nonIncidentEdgeIds(ids, 'src/a'), ['import|src/c|src/d']);
});

test('nonIncidentEdgeIds: every id incident → empty array', () => {
    const ids = ['import|src/a|src/b', 'call|src/c|src/a'];
    assert.deepEqual(nonIncidentEdgeIds(ids, 'src/a'), []);
});

test('nonIncidentEdgeIds: empty input → empty output', () => {
    assert.deepEqual(nonIncidentEdgeIds([], 'src/a'), []);
});

// ---------------------------------------------------------------------------
// readmeKeyCandidates / resolveReadmeDoc
// ---------------------------------------------------------------------------

test('readmeKeyCandidates: returns html, txt, md candidates in resolution order', () => {
    assert.deepEqual(readmeKeyCandidates('src/foo'), [
        'src/foo/README.html',
        'src/foo/README.txt',
        'src/foo/README.md',
    ]);
});

test('resolveReadmeDoc: html is preferred when present', () => {
    const docs: Record<string, DesignDoc> = {
        'src/foo/README.html': { markdown: 'm-html', html: '<p>html</p>' },
        'src/foo/README.md': { markdown: 'm-md', html: '<p>md</p>' },
    };
    const out = resolveReadmeDoc(docs, 'src/foo');
    assert.equal(out?.html, '<p>html</p>');
});

test('resolveReadmeDoc: md is returned when only md exists', () => {
    const docs: Record<string, DesignDoc> = {
        'src/foo/README.md': { markdown: 'm-md', html: '<p>md</p>' },
    };
    const out = resolveReadmeDoc(docs, 'src/foo');
    assert.equal(out?.html, '<p>md</p>');
});

test('resolveReadmeDoc: miss returns null (not undefined)', () => {
    const docs: Record<string, DesignDoc> = {};
    const out = resolveReadmeDoc(docs, 'src/foo');
    assert.equal(out, null);
});

// ---------------------------------------------------------------------------
// Type-level smoke: folder-tree fixture round-trip
// ---------------------------------------------------------------------------

test('buildVisNodes: round-trips a real-shaped FolderTreeData', () => {
    const fixture: FolderTreeData = {
        schemaVersion: FOLDER_TREE_SCHEMA_VERSION,
        timestamp: '2026-05-05T00:00:00.000Z',
        root: makeRootWith([
            {
                path: 'src',
                name: 'src',
                fileCount: 1,
                totalLOC: 10,
                documented: false,
                children: [],
            },
        ]),
    };
    const out = buildVisNodes(fixture.root);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'src');
});
