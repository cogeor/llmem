/**
 * Loop 12 — folder-artifacts on-disk schema contract.
 *
 * Pins the on-disk JSON shape produced by `buildAndSaveFolderArtifacts`
 * (loop 10) by Zod-parsing the raw JSON via the loop-08 schemas plus
 * sorted-`Object.keys` envelope/node assertions.
 *
 * Why both? `Schema.parse()` enforces field-level types; sorted-keys pins
 * the structural shape so a future field addition or rename forces a
 * deliberate test update. Together they form the loop-12-spec
 * "any future schema change must touch this test" contract.
 *
 * NOT a snapshot test — content (LOC counts, edge counts) is fixture-
 * dependent and would make the test brittle to unrelated parser changes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    FolderTreeSchema,
    FOLDER_TREE_SCHEMA_VERSION,
} from '../../src/graph/folder-tree';
import {
    FolderEdgelistSchema,
    FOLDER_EDGES_SCHEMA_VERSION,
} from '../../src/graph/folder-edges';
import { buildAndSaveFolderArtifacts } from '../../src/application/folder-artifacts';
import { scanFolderRecursive } from '../../src/application/scan';
import { createWorkspaceContext } from '../../src/application/workspace-context';
import {
    FOLDER_TREE_FILENAME,
} from '../../src/graph/folder-tree-store';
import {
    FOLDER_EDGELIST_FILENAME,
} from '../../src/graph/folder-edges-store';

function buildFixture(tmp: string): void {
    fs.mkdirSync(path.join(tmp, 'src', 'a'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'src', 'b'), { recursive: true });
    fs.writeFileSync(
        path.join(tmp, 'src', 'a', 'a.ts'),
        'export const a = 1;\n',
        'utf8',
    );
    fs.writeFileSync(
        path.join(tmp, 'src', 'b', 'b.ts'),
        "import { a } from '../a/a';\nexport const b = a + 1;\n",
        'utf8',
    );
}

async function populate(tmp: string): Promise<string> {
    const ctx = await createWorkspaceContext({ workspaceRoot: tmp });
    await scanFolderRecursive(ctx, { folderPath: '.' });
    await buildAndSaveFolderArtifacts(ctx);
    return ctx.artifactRoot;
}

test('folder-tree.json on-disk envelope structure', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-fa-schema-tree-'));
    try {
        buildFixture(tmp);
        const artifactDir = await populate(tmp);

        const treePath = path.join(artifactDir, FOLDER_TREE_FILENAME);
        const raw = JSON.parse(fs.readFileSync(treePath, 'utf-8'));
        const parsed = FolderTreeSchema.parse(raw);

        // Envelope keys.
        assert.deepEqual(
            Object.keys(parsed).sort(),
            ['root', 'schemaVersion', 'timestamp'].sort(),
        );
        assert.equal(parsed.schemaVersion, FOLDER_TREE_SCHEMA_VERSION);
        assert.equal(typeof parsed.timestamp, 'string');

        // Root node keys.
        assert.deepEqual(
            Object.keys(parsed.root).sort(),
            ['children', 'documented', 'fileCount', 'name', 'path', 'totalLOC'].sort(),
        );
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('folder-edgelist.json on-disk envelope structure', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-fa-schema-edges-'));
    try {
        buildFixture(tmp);
        const artifactDir = await populate(tmp);

        const edgesPath = path.join(artifactDir, FOLDER_EDGELIST_FILENAME);
        const raw = JSON.parse(fs.readFileSync(edgesPath, 'utf-8'));
        const parsed = FolderEdgelistSchema.parse(raw);

        // Envelope keys.
        assert.deepEqual(
            Object.keys(parsed).sort(),
            ['edges', 'schemaVersion', 'timestamp', 'weightP90'].sort(),
        );
        assert.equal(parsed.schemaVersion, FOLDER_EDGES_SCHEMA_VERSION);
        assert.equal(typeof parsed.timestamp, 'string');
        assert.equal(typeof parsed.weightP90, 'number');
        assert.ok(Array.isArray(parsed.edges));

        // If at least one edge exists, pin its keys too. The loop-10
        // cross-folder fixture guarantees this on a successful scan.
        if (parsed.edges.length > 0) {
            assert.deepEqual(
                Object.keys(parsed.edges[0]).sort(),
                ['from', 'kind', 'to', 'weight'].sort(),
            );
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
