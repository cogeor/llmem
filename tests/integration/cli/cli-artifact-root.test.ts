/**
 * Portable store (P0 surface) — `--artifact-root` flag and an ABSOLUTE
 * `LLMEM_ARTIFACT_ROOT`, end-to-end through the real CLI binary.
 *
 * Three cases:
 *   1. `llmem scan --artifact-root <abs temp dir>` — edge lists land in
 *      the out-of-tree store; nothing new appears under the workspace.
 *   2. Absolute `LLMEM_ARTIFACT_ROOT` env — same behavior, no flag.
 *   3. Precedence — the flag wins over the env var.
 *
 * Mirrors the spawn harness of cli-scan-folder-artifacts.test.ts.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'llmem');
const DIST_MAIN = path.join(REPO_ROOT, 'dist', 'cli', 'main.js');

function ensureBuilt(): void {
    if (!fs.existsSync(DIST_MAIN)) {
        throw new Error(
            `Expected ${DIST_MAIN} to exist. Run \`npm run build:entrypoints\` before \`npm run test:integration\`.`,
        );
    }
}

function mkTmp(prefix: string): string {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function writeFixture(workspace: string): void {
    fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
    fs.writeFileSync(
        path.join(workspace, 'src', 'a.ts'),
        "import { b } from './b';\nexport const a = b + 1;\n",
    );
    fs.writeFileSync(path.join(workspace, 'src', 'b.ts'), 'export const b = 1;\n');
}

/** Recursive sorted listing of all files under `dir` (relative, POSIX). */
function listAll(dir: string, prefix = ''): string[] {
    const out: string[] = [];
    for (const entry of fs
        .readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) out.push(...listAll(path.join(dir, entry.name), rel));
        else out.push(rel);
    }
    return out;
}

function runScan(
    workspace: string,
    extraArgs: string[],
    extraEnv: Record<string, string> = {},
): Promise<{ exitCode: number | null; output: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(
            'node',
            [BIN, 'scan', '--workspace', workspace, ...extraArgs],
            {
                cwd: workspace,
                env: { ...process.env, FORCE_COLOR: '0', ...extraEnv },
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

function assertStorePopulated(store: string, output: string): void {
    for (const f of ['import-edgelist.json', 'call-edgelist.json']) {
        assert.ok(
            fs.existsSync(path.join(store, f)),
            `expected ${f} in ${store}; CLI output:\n${output}`,
        );
    }
    const raw = JSON.parse(
        fs.readFileSync(path.join(store, 'import-edgelist.json'), 'utf8'),
    );
    const fileIds = new Set((raw.nodes as Array<{ fileId: string }>).map((n) => n.fileId));
    assert.ok(fileIds.has('src/a.ts') && fileIds.has('src/b.ts'));
}

test('scan --artifact-root <abs>: artifacts land out-of-tree, workspace untouched', async () => {
    ensureBuilt();
    const workspace = mkTmp('llmem-cli-aroot-ws-');
    const store = mkTmp('llmem-cli-aroot-store-');
    try {
        writeFixture(workspace);
        const before = listAll(workspace);

        const { exitCode, output } = await runScan(workspace, [
            '--artifact-root',
            store,
        ]);
        assert.equal(exitCode, 0, `expected exit 0; output:\n${output}`);
        assertStorePopulated(store, output);
        assert.deepEqual(
            listAll(workspace),
            before,
            'scan must write NOTHING into the workspace with an out-of-tree store',
        );
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
        fs.rmSync(store, { recursive: true, force: true });
    }
});

test('absolute LLMEM_ARTIFACT_ROOT: artifacts land out-of-tree end-to-end', async () => {
    ensureBuilt();
    const workspace = mkTmp('llmem-cli-aroot-ws-');
    const store = mkTmp('llmem-cli-aroot-env-');
    try {
        writeFixture(workspace);
        const before = listAll(workspace);

        const { exitCode, output } = await runScan(workspace, [], {
            LLMEM_ARTIFACT_ROOT: store,
        });
        assert.equal(exitCode, 0, `expected exit 0; output:\n${output}`);
        assertStorePopulated(store, output);
        assert.deepEqual(listAll(workspace), before);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
        fs.rmSync(store, { recursive: true, force: true });
    }
});

test('precedence: --artifact-root wins over LLMEM_ARTIFACT_ROOT', async () => {
    ensureBuilt();
    const workspace = mkTmp('llmem-cli-aroot-ws-');
    const flagStore = mkTmp('llmem-cli-aroot-flag-');
    const envStore = mkTmp('llmem-cli-aroot-envloser-');
    try {
        writeFixture(workspace);

        const { exitCode, output } = await runScan(
            workspace,
            ['--artifact-root', flagStore],
            { LLMEM_ARTIFACT_ROOT: envStore },
        );
        assert.equal(exitCode, 0, `expected exit 0; output:\n${output}`);
        assertStorePopulated(flagStore, output);
        assert.ok(
            !fs.existsSync(path.join(envStore, 'import-edgelist.json')),
            'env-var store must stay empty when the flag is given',
        );
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
        fs.rmSync(flagStore, { recursive: true, force: true });
        fs.rmSync(envStore, { recursive: true, force: true });
    }
});
