// tests/integration/portable-store.test.ts
//
// Portable artifact store (P0): a scan with an ABSOLUTE out-of-tree
// `artifactRoot` must land every artifact (edge lists, folder artifacts,
// scan manifest, watch state) in that directory and write NOTHING new
// into the fixture workspace.
//
// Mirrors the mkdtemp fixture pattern of scan-ignored-dirs.test.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { scanFolderRecursive } from '../../src/application/scan';
import { buildAndSaveFolderArtifacts } from '../../src/application/folder-artifacts';
import { createWorkspaceContext } from '../../src/application/workspace-context';
import { CallEdgeListStore, ImportEdgeListStore } from '../../src/graph/edgelist';

function mkTmp(prefix: string): string {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function write(root: string, rel: string, content: string): void {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
}

/** Recursive sorted listing of all files under `dir` (relative, POSIX). */
function listAll(dir: string, prefix = ''): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) out.push(...listAll(path.join(dir, entry.name), rel));
        else out.push(rel);
    }
    return out;
}

test('scan with absolute out-of-tree artifactRoot: artifacts land there, workspace untouched', async () => {
    const workspace = mkTmp('llmem-portable-ws-');
    const store = mkTmp('llmem-portable-store-');
    try {
        write(workspace, 'src/a.ts', "import { b } from './b';\nexport const a = b + 1;\n");
        write(workspace, 'src/b.ts', 'export const b = 1;\n');
        const before = listAll(workspace);

        const ctx = await createWorkspaceContext({
            workspaceRoot: workspace,
            configOverrides: { artifactRoot: store },
        });
        assert.equal(ctx.artifactRoot, store);
        assert.equal(ctx.artifactRootRel, null);

        const result = await scanFolderRecursive(ctx, { folderPath: '.' });
        assert.equal(result.errors.length, 0);
        assert.ok(result.filesProcessed >= 2, `expected >=2 files, got ${result.filesProcessed}`);
        await buildAndSaveFolderArtifacts(ctx);

        // Edge lists + folder artifacts landed in the out-of-tree store.
        for (const f of [
            'import-edgelist.json',
            'call-edgelist.json',
            'folder-tree.json',
            'folder-edgelist.json',
        ]) {
            assert.ok(
                fs.existsSync(path.join(store, f)),
                `expected ${f} in the out-of-tree store`,
            );
        }

        // The stores read back through the artifact-scoped IO.
        const importStore = new ImportEdgeListStore(ctx.artifactRoot, ctx.artifactIo);
        const callStore = new CallEdgeListStore(ctx.artifactRoot, ctx.artifactIo);
        await importStore.load();
        await callStore.load();
        const fileIds = new Set(importStore.getNodes().map((n) => n.fileId));
        assert.ok(fileIds.has('src/a.ts') && fileIds.has('src/b.ts'));
        assert.ok(
            importStore.getEdges().some((e) => e.source === 'src/a.ts' && e.target === 'src/b.ts'),
            'expected the a → b import edge',
        );
        assert.ok(callStore.getNodes().length > 0, 'call store populated');

        // NOTHING new written under the fixture workspace.
        assert.deepEqual(listAll(workspace), before);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
        fs.rmSync(store, { recursive: true, force: true });
    }
});
