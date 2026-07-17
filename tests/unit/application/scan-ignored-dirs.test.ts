// tests/unit/application/scan-ignored-dirs.test.ts
//
// End-to-end pin for the venv/cache marker-file pruning in the scan walk
// (`scanFolderRecursive` → `isIgnoredDir`).
//
// A venv with a nonstandard name (real case: `.venv_diffdock_pp`) is not in
// IGNORED_FOLDERS, so the walk used to crawl its whole site-packages tree
// (observed: 60k+ import-graph nodes, 10+ minute scans). The walk must now
// prune any directory containing `pyvenv.cfg` or `CACHEDIR.TAG` while still
// descending into normal source dirs.
//
// Mirrors the mkdtemp fixture pattern of scan-filters.test.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { scanFolderRecursive } from '../../../src/application/scan';
import { createWorkspaceContext } from '../../../src/application/workspace-context';
import { CallEdgeListStore, ImportEdgeListStore } from '../../../src/graph/edgelist';

function makeRoot(): string {
    return fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-scanignore-')),
    );
}

function write(root: string, rel: string, content: string): void {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
}

async function ctxFor(root: string) {
    const ctx = await createWorkspaceContext({
        workspaceRoot: root,
        configOverrides: {},
    });
    fs.mkdirSync(ctx.artifactRoot, { recursive: true });
    return ctx;
}

/** File-node ids present in either store after a scan. */
async function loadFileIds(root: string): Promise<Set<string>> {
    const ctx = await ctxFor(root);
    const callStore = new CallEdgeListStore(ctx.artifactRoot, ctx.io);
    const importStore = new ImportEdgeListStore(ctx.artifactRoot, ctx.io);
    await callStore.load();
    await importStore.load();
    const ids = new Set<string>();
    for (const n of [...callStore.getNodes(), ...importStore.getNodes()]) {
        ids.add(n.fileId);
    }
    return ids;
}

const SIMPLE_TS = 'export const x = 1;\nexport function f() { return x; }\n';

test('scan walk: dirs with pyvenv.cfg / CACHEDIR.TAG are pruned, normal dirs are scanned', async () => {
    const root = makeRoot();
    try {
        // Normal source — must be scanned.
        write(root, 'src/a.ts', SIMPLE_TS);
        write(root, 'normal/util.ts', SIMPLE_TS);

        // Nonstandard-named venv — must be pruned via the pyvenv.cfg marker.
        write(root, 'my_custom_env/pyvenv.cfg', 'home = /usr/bin\n');
        write(root, 'my_custom_env/lib/pkg.ts', SIMPLE_TS);

        // Cache dir — must be pruned via the CACHEDIR.TAG marker.
        write(
            root,
            'some_cache/CACHEDIR.TAG',
            'Signature: 8a477f597d28d172789f06886806bc55\n',
        );
        write(root, 'some_cache/mod.ts', SIMPLE_TS);

        const ctx = await ctxFor(root);
        await scanFolderRecursive(ctx, { folderPath: '.' });

        const fileIds = await loadFileIds(root);
        assert.ok(fileIds.has('src/a.ts'), 'normal source file must be in the graph');
        assert.ok(fileIds.has('normal/util.ts'), 'normal source dir must be scanned');
        for (const id of fileIds) {
            assert.ok(
                !id.startsWith('my_custom_env/'),
                `venv file leaked into graph: ${id}`,
            );
            assert.ok(
                !id.startsWith('some_cache/'),
                `cache-dir file leaked into graph: ${id}`,
            );
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
