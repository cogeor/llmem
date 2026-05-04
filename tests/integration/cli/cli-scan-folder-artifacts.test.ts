/**
 * Loop 10 — `bin/llmem scan` emits all four artifacts.
 *
 * Closes the loop-05 stub from the user-facing side. Mirrors the
 * happy-path / partial-success structure of `cli-scan.test.ts` and adds
 * assertions on `folder-tree.json` + `folder-edgelist.json` (load via
 * the loop-09 stores → Zod validation).
 *
 * Two cases:
 *   1. Happy path — fresh workspace with two TS files in different
 *      folders; exit 0 and all four artifacts on disk.
 *   2. Partial-success — one file fails to parse; exit 1 BUT all four
 *      artifacts are still emitted (pins the contract from PLAN.md
 *      Task 4 step 2).
 */

// TODO(loop 06+): extract REPO_ROOT/BIN/DIST_MAIN/ensureBuilt to a shared
// tests/integration/cli/_helpers.ts when cli-document.test.ts adds the
// third instance. (Same TODO carried over from cli-scan.test.ts.)

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

function ensureBuilt(): void {
    if (!fs.existsSync(DIST_MAIN)) {
        throw new Error(
            `Expected ${DIST_MAIN} to exist. Run \`npm run build:claude\` before \`npm run test:integration\`.`,
        );
    }
}

function runScan(
    tmp: string,
    extraArgs: string[] = [],
): Promise<{ exitCode: number | null; output: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(
            'node',
            [BIN, 'scan', '--workspace', tmp, ...extraArgs],
            {
                cwd: tmp,
                env: { ...process.env, FORCE_COLOR: '0' },
                stdio: ['ignore', 'pipe', 'pipe'],
            },
        );

        let buf = '';
        const onData = (chunk: Buffer) => {
            buf += chunk.toString('utf8');
        };
        child.stdout!.on('data', onData);
        child.stderr!.on('data', onData);

        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`scan timed out; output so far:\n${buf}`));
        }, 60_000);

        child.once('exit', (code) => {
            clearTimeout(timer);
            resolve({ exitCode: code, output: buf });
        });
        child.once('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

test('scan: happy path emits all four artifacts (folder-tree + folder-edgelist included)', async () => {
    ensureBuilt();

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-scan-fa-'));
    fs.mkdirSync(path.join(tmp, 'src', 'a'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'src', 'b'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'a', 'a.ts'), 'export const a = 1;\n', 'utf8');
    fs.writeFileSync(
        path.join(tmp, 'src', 'b', 'b.ts'),
        "import { a } from '../a/a';\nexport const b = a + 1;\n",
        'utf8',
    );

    try {
        const { exitCode, output } = await runScan(tmp);

        assert.equal(
            exitCode,
            0,
            `expected exit 0 on clean workspace, got ${exitCode}; output:\n${output}`,
        );

        const artifacts = path.join(tmp, '.artifacts');
        assert.ok(
            fs.existsSync(path.join(artifacts, 'import-edgelist.json')),
            'expected import-edgelist.json',
        );
        assert.ok(
            fs.existsSync(path.join(artifacts, 'call-edgelist.json')),
            'expected call-edgelist.json',
        );
        assert.ok(
            fs.existsSync(path.join(artifacts, FOLDER_TREE_FILENAME)),
            `expected ${FOLDER_TREE_FILENAME}`,
        );
        assert.ok(
            fs.existsSync(path.join(artifacts, FOLDER_EDGELIST_FILENAME)),
            `expected ${FOLDER_EDGELIST_FILENAME}`,
        );

        // Load both folder artifacts → Zod validation.
        const io = await WorkspaceIO.create(asWorkspaceRoot(tmp));
        const tree = await new FolderTreeStore(artifacts, io).load();
        assert.equal(tree.schemaVersion, 1);
        assert.ok(Array.isArray(tree.root.children));
        assert.equal(tree.root.fileCount, 2, 'expected fileCount 2 (a.ts + b.ts)');

        const edges = await new FolderEdgelistStore(artifacts, io).load();
        assert.equal(edges.schemaVersion, 1);
        assert.ok(Array.isArray(edges.edges));
        // src/b imports from src/a — at least one folder-level import edge.
        const cross = edges.edges.find(
            (e) => e.kind === 'import' && e.from === 'src/b' && e.to === 'src/a',
        );
        assert.ok(
            cross,
            `expected a cross-folder import edge from src/b to src/a; got ${JSON.stringify(edges.edges)}`,
        );
    } finally {
        try {
            fs.rmSync(tmp, { recursive: true, force: true });
        } catch {
            // Best-effort cleanup — Windows file watchers can delay release.
        }
    }
});

test('scan: partial-success still emits all four artifacts (exit 1)', async () => {
    ensureBuilt();

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-scan-fa-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'good.ts'), 'export const x = 1;\n', 'utf8');
    // Same parse-error trick as cli-scan.test.ts: 3000 levels of nested
    // brackets overflows the recursive ts.forEachChild walk.
    const depth = 3000;
    fs.writeFileSync(
        path.join(tmp, 'src', 'broken.ts'),
        '['.repeat(depth) + '1' + ']'.repeat(depth) + ';\n',
        'utf8',
    );

    try {
        const { exitCode, output } = await runScan(tmp);

        assert.equal(
            exitCode,
            1,
            `expected exit 1 on parse error, got ${exitCode}; output:\n${output}`,
        );

        // Folder artifacts must exist even after the parse-error exit gate
        // fires (helper runs BEFORE process.exit(1)).
        const artifacts = path.join(tmp, '.artifacts');
        assert.ok(
            fs.existsSync(path.join(artifacts, 'import-edgelist.json')),
            'expected import-edgelist.json on partial-success',
        );
        assert.ok(
            fs.existsSync(path.join(artifacts, 'call-edgelist.json')),
            'expected call-edgelist.json on partial-success',
        );
        assert.ok(
            fs.existsSync(path.join(artifacts, FOLDER_TREE_FILENAME)),
            `expected ${FOLDER_TREE_FILENAME} on partial-success`,
        );
        assert.ok(
            fs.existsSync(path.join(artifacts, FOLDER_EDGELIST_FILENAME)),
            `expected ${FOLDER_EDGELIST_FILENAME} on partial-success`,
        );

        // The folder artifacts should still be loadable.
        const io = await WorkspaceIO.create(asWorkspaceRoot(tmp));
        const tree = await new FolderTreeStore(artifacts, io).load();
        assert.equal(tree.schemaVersion, 1);
        const edges = await new FolderEdgelistStore(artifacts, io).load();
        assert.equal(edges.schemaVersion, 1);
    } finally {
        try {
            fs.rmSync(tmp, { recursive: true, force: true });
        } catch {
            // Best-effort cleanup — Windows file watchers can delay release.
        }
    }
});
