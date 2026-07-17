/**
 * Portable store (P1) — `--store global` end-to-end through the real CLI
 * binary (mirrors the spawn harness of cli-artifact-root.test.ts).
 *
 * The store BASE is pointed at a temp dir via LLMEM_STORE_DIR (the resolver's
 * documented base override) so the test never touches the real platform
 * cache dir. Cases:
 *   1. `llmem scan --store global` — edge lists land under
 *      <base>/llmem/store/<name>-<hash8>/graph (computed with the SAME
 *      resolver the CLI uses), nothing appears under the workspace, and the
 *      resolved location is printed (`Artifacts: ...`).
 *   2. Precedence — `--artifact-root` beats `--store global`.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { resolveGlobalStoreRoot } from '../../../src/workspace/store-location';
import { ENV_VARS } from '../../../src/config-defaults';

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
                // Neutralize any ambient portable-store env from the host
                // shell (empty string is falsy in the precedence chain).
                env: {
                    ...process.env,
                    FORCE_COLOR: '0',
                    [ENV_VARS.ARTIFACT_ROOT]: '',
                    [ENV_VARS.STORE]: '',
                    ...extraEnv,
                },
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

test('scan --store global: artifacts land in the keyed per-user store, workspace untouched', async () => {
    ensureBuilt();
    const workspace = mkTmp('llmem-cli-store-ws-');
    const base = mkTmp('llmem-cli-store-base-');
    try {
        writeFixture(workspace);
        const before = listAll(workspace);

        const { exitCode, output } = await runScan(workspace, ['--store', 'global'], {
            [ENV_VARS.STORE_DIR]: base,
        });
        assert.equal(exitCode, 0, `expected exit 0; output:\n${output}`);

        // Same resolver the CLI uses, same LLMEM_STORE_DIR base.
        const expectedStore = resolveGlobalStoreRoot(workspace, {
            env: { [ENV_VARS.STORE_DIR]: base },
        });
        assert.ok(
            expectedStore.startsWith(path.join(base, 'llmem', 'store')),
            `resolver must honor LLMEM_STORE_DIR; got ${expectedStore}`,
        );
        assertStorePopulated(expectedStore, output);

        // Discoverability: the resolved location is printed.
        assert.ok(
            output.includes(`Artifacts: ${expectedStore}`),
            `expected "Artifacts: ${expectedStore}" in output:\n${output}`,
        );

        assert.deepEqual(
            listAll(workspace),
            before,
            'scan must write NOTHING into the workspace with --store global',
        );
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
        fs.rmSync(base, { recursive: true, force: true });
    }
});

test('precedence: --artifact-root beats --store global', async () => {
    ensureBuilt();
    const workspace = mkTmp('llmem-cli-store-ws-');
    const base = mkTmp('llmem-cli-store-base-');
    const flagStore = mkTmp('llmem-cli-store-flag-');
    try {
        writeFixture(workspace);

        const { exitCode, output } = await runScan(
            workspace,
            ['--store', 'global', '--artifact-root', flagStore],
            { [ENV_VARS.STORE_DIR]: base },
        );
        assert.equal(exitCode, 0, `expected exit 0; output:\n${output}`);
        assertStorePopulated(flagStore, output);
        assert.ok(
            !fs.existsSync(path.join(base, 'llmem')),
            'global store must stay empty when --artifact-root is given',
        );
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
        fs.rmSync(base, { recursive: true, force: true });
        fs.rmSync(flagStore, { recursive: true, force: true });
    }
});
