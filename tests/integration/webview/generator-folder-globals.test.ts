/**
 * Loop 11 — `generateStaticWebview` emits `folder_tree.js` + `folder_edges.js`
 * and injects the matching `<script>` tags before `js/main.js`.
 *
 * Three cases:
 *   1. Happy path — both new globals are emitted as plain `window.FOLDER_*`
 *      assignments and round-trip as valid JSON whose `schemaVersion` is 1.
 *   2. Injection order — both `folder_tree.js` and `folder_edges.js`
 *      `<script>` tags appear in `index.html` BEFORE `js/main.js`, so the
 *      bootstrap can read `window.FOLDER_TREE` / `window.FOLDER_EDGES`
 *      synchronously.
 *   3. Regression — the four pre-existing assets (`graph_data.js`,
 *      `work_tree.js`, `design_docs.js`, `js/main.js`) still emit, and
 *      `graph_data.js` still defines `window.GRAPH_DATA`. Proves the new
 *      code is purely additive.
 *
 * Each test writes into a fresh `mkdtempSync` workspace; the repo's own
 * `.artifacts/webview/` cache is never touched (per CLAUDE.md cache rule).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { generateStaticWebview } from '../../../src/webview/generator';
import { scanFolderRecursive } from '../../../src/application/scan';
import { buildAndSaveFolderArtifacts } from '../../../src/application/folder-artifacts';
import { ImportEdgeListStore, CallEdgeListStore } from '../../../src/graph/edgelist';
import { prepareWebviewDataFromSplitEdgeLists } from '../../../src/graph/webview-data';
import { createWorkspaceContext } from '../../../src/application/workspace-context';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DIST_WEBVIEW_INDEX = path.join(REPO_ROOT, 'dist', 'webview', 'index.html');

function ensureBuilt(): void {
    if (!fs.existsSync(DIST_WEBVIEW_INDEX)) {
        throw new Error(
            `Expected ${DIST_WEBVIEW_INDEX} to exist. ` +
            `Run "npm run build:webview" first (or use "npm test", which runs build:webview as part of pretest).`,
        );
    }
}

function mkTmp(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rm(p: string): void {
    try {
        fs.rmSync(p, { recursive: true, force: true });
    } catch {
        // Best-effort cleanup — Windows file watchers can delay release.
    }
}

/**
 * Two TS files in different sibling folders so the folder-edgelist
 * has a non-empty `edges` array (mirrors loop 10's regenerator test).
 */
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

interface SetupResult {
    tmp: string;
    parent: string;
    artifactDir: string;
    webviewDir: string;
    realRoot: string;
}

/**
 * Build a fixture, populate edge lists + folder artifacts, and run
 * `generateStaticWebview` against the resulting workspace. Returns the
 * paths the assertions need.
 */
async function setup(prefix: string, options: { graphOnly?: boolean } = {}): Promise<SetupResult> {
    ensureBuilt();

    const parent = mkTmp(prefix);
    const tmp = path.join(parent, 'workspace');
    fs.mkdirSync(tmp);
    buildFixture(tmp);

    const ctx = await createWorkspaceContext({ workspaceRoot: tmp });
    const realRoot = ctx.workspaceRoot;
    const artifactDir = ctx.artifactRoot;

    await scanFolderRecursive(ctx, { folderPath: '.' });

    await buildAndSaveFolderArtifacts(ctx);

    const importStore = new ImportEdgeListStore(artifactDir);
    const callStore = new CallEdgeListStore(artifactDir);
    await importStore.load();
    await callStore.load();
    const graphData = prepareWebviewDataFromSplitEdgeLists(
        importStore.getData(),
        callStore.getData(),
        new Set<string>(),
    );

    const webviewDir = path.join(artifactDir, 'webview');
    await generateStaticWebview(
        webviewDir,
        REPO_ROOT,
        realRoot,
        graphData,
        { graphOnly: options.graphOnly ?? false },
        [],
        ctx,
    );

    return { tmp, parent, artifactDir, webviewDir, realRoot };
}

test('generateStaticWebview: emits folder_tree.js + folder_edges.js with valid window assignments', async () => {
    const { parent, webviewDir } = await setup('llmem-gen-fg-');
    try {
        const folderTreeJs = path.join(webviewDir, 'folder_tree.js');
        const folderEdgesJs = path.join(webviewDir, 'folder_edges.js');
        assert.ok(fs.existsSync(folderTreeJs), `expected ${folderTreeJs}`);
        assert.ok(fs.existsSync(folderEdgesJs), `expected ${folderEdgesJs}`);

        const treeJs = fs.readFileSync(folderTreeJs, 'utf8');
        const edgesJs = fs.readFileSync(folderEdgesJs, 'utf8');
        assert.match(treeJs, /^window\.FOLDER_TREE\s*=\s*\{/);
        assert.match(edgesJs, /^window\.FOLDER_EDGES\s*=\s*\{/);

        // Round-trip: strip the `window.X = ` prefix and trailing `;` and
        // parse as JSON. Confirms valid JSON, not a JS literal that just
        // happens to start with `window.*`.
        const treeJson = JSON.parse(
            treeJs.replace(/^window\.FOLDER_TREE\s*=\s*/, '').replace(/;\s*$/, ''),
        );
        const edgesJson = JSON.parse(
            edgesJs.replace(/^window\.FOLDER_EDGES\s*=\s*/, '').replace(/;\s*$/, ''),
        );
        assert.equal(treeJson.schemaVersion, 1);
        assert.equal(edgesJson.schemaVersion, 1);
        assert.ok(Array.isArray(edgesJson.edges));
    } finally {
        rm(parent);
    }
});

test('generateStaticWebview: index.html injects both folder script tags BEFORE js/main.js', async () => {
    const { parent, webviewDir } = await setup('llmem-gen-fg-');
    try {
        const indexHtml = fs.readFileSync(path.join(webviewDir, 'index.html'), 'utf8');

        const treeTag = '<script src="folder_tree.js"></script>';
        const edgesTag = '<script src="folder_edges.js"></script>';
        const mainTag = '<script src="js/main.js"></script>';

        const treeIdx = indexHtml.indexOf(treeTag);
        const edgesIdx = indexHtml.indexOf(edgesTag);
        const mainIdx = indexHtml.indexOf(mainTag);

        assert.ok(treeIdx >= 0, 'expected folder_tree.js script tag in index.html');
        assert.ok(edgesIdx >= 0, 'expected folder_edges.js script tag in index.html');
        assert.ok(mainIdx >= 0, 'expected js/main.js script tag in index.html');
        assert.ok(treeIdx < mainIdx, 'folder_tree.js must precede js/main.js');
        assert.ok(edgesIdx < mainIdx, 'folder_edges.js must precede js/main.js');
    } finally {
        rm(parent);
    }
});

test('generateStaticWebview: pre-existing assets still emit (graph_data.js / work_tree.js / design_docs.js / js/main.js)', async () => {
    const { parent, webviewDir } = await setup('llmem-gen-fg-');
    try {
        assert.ok(
            fs.existsSync(path.join(webviewDir, 'graph_data.js')),
            'graph_data.js should still emit',
        );
        assert.ok(
            fs.existsSync(path.join(webviewDir, 'work_tree.js')),
            'work_tree.js should still emit',
        );
        assert.ok(
            fs.existsSync(path.join(webviewDir, 'design_docs.js')),
            'design_docs.js should still emit',
        );
        assert.ok(
            fs.existsSync(path.join(webviewDir, 'js', 'main.js')),
            'js/main.js should still emit',
        );

        // Smoke: graph_data.js still defines window.GRAPH_DATA.
        const graphDataJs = fs.readFileSync(path.join(webviewDir, 'graph_data.js'), 'utf8');
        assert.match(graphDataJs, /^window\.GRAPH_DATA\s*=\s*\{/);
    } finally {
        rm(parent);
    }
});
