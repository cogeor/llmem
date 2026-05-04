/**
 * Loop 11 followup — `bin/llmem serve` emits all four artifacts.
 *
 * Closes the gap left when folder-artifact emission lived only in the
 * regenerator path. The CLI's `serve` command calls `generateGraph`
 * directly when no webview directory exists; that call now produces
 * `folder-tree.json` + `folder-edgelist.json` alongside the edge lists.
 *
 * Mirrors the structure of `cli-serve-zero-config.test.ts`: spawn
 * `node bin/llmem serve --port 0 --no-open --workspace <tmp>`, wait for
 * the "Server running" announcement, kill cleanly, and assert all four
 * artifacts exist on disk.
 *
 * Cross-platform notes (carried over from the zero-config test):
 *  - `spawn('node', [BIN, ...])` rather than `spawn(BIN, ...)`. Bypasses
 *    the npm `.cmd` wrapper on Windows; tests the real JS shim.
 *  - `--port 0` so two parallel runs do not collide.
 *  - `--no-open` is mandatory (default-on `--open` would fire `cmd /c
 *    start` / `xdg-open` on CI).
 *  - `LLMEM_ASSET_ROOT` points at the repo's `dist/webview` so the cold
 *    regenerate finds the prebuilt webview HTML/JS — the tmp workspace
 *    has no `dist/`.
 *  - Best-effort cleanup; Windows file watchers may delay release.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

import {
    FolderTreeStore,
    FOLDER_TREE_FILENAME,
} from '../../../src/graph/folder-tree-store';
import {
    FolderEdgelistStore,
    FOLDER_EDGELIST_FILENAME,
} from '../../../src/graph/folder-edges-store';
import { WorkspaceIO } from '../../../src/workspace/workspace-io';
import { asWorkspaceRoot } from '../../../src/core/paths';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'llmem');
const DIST_MAIN = path.join(REPO_ROOT, 'dist', 'claude', 'cli', 'main.js');
const DIST_WEBVIEW = path.join(REPO_ROOT, 'dist', 'webview');

function ensureBuilt(): void {
    if (!fs.existsSync(DIST_MAIN)) {
        throw new Error(
            `Expected ${DIST_MAIN} to exist. Run \`npm run build:claude\` before \`npm run test:integration\`.`,
        );
    }
    if (!fs.existsSync(path.join(DIST_WEBVIEW, 'index.html'))) {
        throw new Error(
            `Expected ${DIST_WEBVIEW}/index.html to exist. Run \`npm run build:webview\` before \`npm run test:integration\`.`,
        );
    }
}

/**
 * Wait for a regex on the child's combined stdout+stderr, with a deadline.
 *
 * `serve` writes the "Server running ..." announcement via the structured
 * logger (stderr). Workspace and indexing summary lines come through
 * `console.log` (stdout). We watch both streams.
 */
function waitForOutput(
    child: ReturnType<typeof spawn>,
    re: RegExp,
    ms: number,
): Promise<string> {
    return new Promise((resolve, reject) => {
        let buf = '';
        const timer = setTimeout(() => {
            reject(new Error(`Timed out waiting for ${re}; output so far:\n${buf}`));
        }, ms);
        const onData = (chunk: Buffer) => {
            buf += chunk.toString('utf8');
            if (re.test(buf)) {
                clearTimeout(timer);
                child.stdout!.removeListener('data', onData);
                child.stderr!.removeListener('data', onData);
                resolve(buf);
            }
        };
        child.stdout!.on('data', onData);
        child.stderr!.on('data', onData);
    });
}

test('serve: cold start emits all four artifacts (folder-tree + folder-edgelist included)', async () => {
    ensureBuilt();

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-serve-fa-'));
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

    const child = spawn(
        'node',
        [BIN, 'serve', '--port', '0', '--no-open', '--workspace', tmp],
        {
            cwd: tmp,
            env: {
                ...process.env,
                FORCE_COLOR: '0',
                LLMEM_ASSET_ROOT: DIST_WEBVIEW,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    );

    try {
        await waitForOutput(
            child,
            /Server running.*127\.0\.0\.1:(\d+)/,
            60_000,
        );

        const artifacts = path.join(tmp, '.artifacts');
        assert.ok(
            fs.existsSync(path.join(artifacts, 'import-edgelist.json')),
            'expected import-edgelist.json after cold-start serve',
        );
        assert.ok(
            fs.existsSync(path.join(artifacts, 'call-edgelist.json')),
            'expected call-edgelist.json after cold-start serve',
        );
        assert.ok(
            fs.existsSync(path.join(artifacts, FOLDER_TREE_FILENAME)),
            `expected ${FOLDER_TREE_FILENAME} after cold-start serve`,
        );
        assert.ok(
            fs.existsSync(path.join(artifacts, FOLDER_EDGELIST_FILENAME)),
            `expected ${FOLDER_EDGELIST_FILENAME} after cold-start serve`,
        );

        // Both folder artifacts must round-trip through the loop-09 stores
        // (Zod validation), and the tree must reflect the two source files.
        const io = await WorkspaceIO.create(asWorkspaceRoot(tmp));
        const tree = await new FolderTreeStore(artifacts, io).load();
        assert.equal(tree.schemaVersion, 1);
        assert.equal(
            tree.root.fileCount,
            2,
            'expected fileCount 2 (a.ts + b.ts)',
        );

        const edges = await new FolderEdgelistStore(artifacts, io).load();
        assert.equal(edges.schemaVersion, 1);
        const cross = edges.edges.find(
            (e) =>
                e.kind === 'import' &&
                e.from === 'src/b' &&
                e.to === 'src/a',
        );
        assert.ok(
            cross,
            `expected a cross-folder import edge from src/b to src/a; got ${JSON.stringify(edges.edges)}`,
        );
    } finally {
        child.kill('SIGINT');
        await new Promise<void>((resolve) => {
            child.once('exit', () => resolve());
        });
        try {
            fs.rmSync(tmp, { recursive: true, force: true });
        } catch {
            // Best-effort cleanup — Windows file watchers can delay release.
        }
    }
});
