// tests/unit/cli/context-store.test.ts
//
// Precedence coverage at the `cli.createWorkspace` seam (src/cli/context.ts)
// for the P1 portable store — the ONE place the CLI folds
// `--artifact-root` / LLMEM_ARTIFACT_ROOT / `--store` / LLMEM_STORE into the
// effective artifact root before `initWorkspaceContext`:
//
//   1. --store global → per-user store (LLMEM_STORE_DIR-controlled here so
//      the test never writes to the real platform cache dir).
//   2. LLMEM_STORE=global (env, no flag) → same store.
//   3. explicit --store repo beats LLMEM_STORE=global → in-tree default.
//   4. --artifact-root (config override) beats --store global.
//   5. LLMEM_ARTIFACT_ROOT beats --store global.
//
// Contexts are built against throwaway temp workspaces; every env mutation
// is restored in try/finally.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createCliContext } from '../../../src/cli/context';
import { resolveGlobalStoreRoot } from '../../../src/workspace/store-location';
import { ENV_VARS } from '../../../src/config-defaults';

const MANAGED = [ENV_VARS.ARTIFACT_ROOT, ENV_VARS.STORE, ENV_VARS.STORE_DIR];

function mkTmp(tag: string): string {
    return fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), `llmem-ctx-store-${tag}-`)),
    );
}

async function withEnv<T>(
    env: Record<string, string | undefined>,
    fn: () => Promise<T>,
): Promise<T> {
    const saved = new Map(MANAGED.map((k) => [k, process.env[k]] as const));
    for (const k of MANAGED) delete process.env[k];
    for (const [k, v] of Object.entries(env)) {
        if (v !== undefined) process.env[k] = v;
    }
    try {
        return await fn();
    } finally {
        for (const [k, v] of saved) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
}

test('createWorkspace seam: --store global lands in the per-user store (LLMEM_STORE_DIR base)', async () => {
    const ws = mkTmp('ws');
    const base = mkTmp('base');
    try {
        await withEnv({ [ENV_VARS.STORE_DIR]: base }, async () => {
            const ctx = await createCliContext().createWorkspace(ws, {}, { store: 'global' });
            const expected = resolveGlobalStoreRoot(ws);
            assert.ok(
                expected.startsWith(path.join(base, 'llmem', 'store')),
                `resolver must honor LLMEM_STORE_DIR; got ${expected}`,
            );
            assert.equal(ctx.artifactRoot, fs.realpathSync(expected));
        });
    } finally {
        fs.rmSync(ws, { recursive: true, force: true });
        fs.rmSync(base, { recursive: true, force: true });
    }
});

test('createWorkspace seam: LLMEM_STORE=global applies without a --store flag', async () => {
    const ws = mkTmp('ws');
    const base = mkTmp('base');
    try {
        await withEnv(
            { [ENV_VARS.STORE]: 'global', [ENV_VARS.STORE_DIR]: base },
            async () => {
                const ctx = await createCliContext().createWorkspace(ws);
                assert.equal(ctx.artifactRoot, fs.realpathSync(resolveGlobalStoreRoot(ws)));
            },
        );
    } finally {
        fs.rmSync(ws, { recursive: true, force: true });
        fs.rmSync(base, { recursive: true, force: true });
    }
});

test('createWorkspace seam: explicit --store repo beats LLMEM_STORE=global', async () => {
    const ws = mkTmp('ws');
    const base = mkTmp('base');
    try {
        await withEnv(
            { [ENV_VARS.STORE]: 'global', [ENV_VARS.STORE_DIR]: base },
            async () => {
                const ctx = await createCliContext().createWorkspace(ws, {}, { store: 'repo' });
                assert.equal(ctx.artifactRoot, path.join(ws, '.llmem', 'graph'));
                assert.ok(
                    !fs.existsSync(path.join(base, 'llmem')),
                    'global store base must stay untouched with --store repo',
                );
            },
        );
    } finally {
        fs.rmSync(ws, { recursive: true, force: true });
        fs.rmSync(base, { recursive: true, force: true });
    }
});

test('createWorkspace seam: --artifact-root override beats --store global', async () => {
    const ws = mkTmp('ws');
    const base = mkTmp('base');
    const flagRoot = mkTmp('flagroot');
    try {
        await withEnv({ [ENV_VARS.STORE_DIR]: base }, async () => {
            const ctx = await createCliContext().createWorkspace(
                ws,
                { artifactRoot: flagRoot },
                { store: 'global' },
            );
            assert.equal(ctx.artifactRoot, flagRoot);
            assert.ok(!fs.existsSync(path.join(base, 'llmem')));
        });
    } finally {
        fs.rmSync(ws, { recursive: true, force: true });
        fs.rmSync(base, { recursive: true, force: true });
        fs.rmSync(flagRoot, { recursive: true, force: true });
    }
});

test('createWorkspace seam: LLMEM_ARTIFACT_ROOT beats --store global', async () => {
    const ws = mkTmp('ws');
    const base = mkTmp('base');
    const envRoot = mkTmp('envroot');
    try {
        await withEnv(
            { [ENV_VARS.ARTIFACT_ROOT]: envRoot, [ENV_VARS.STORE_DIR]: base },
            async () => {
                const ctx = await createCliContext().createWorkspace(ws, {}, { store: 'global' });
                assert.equal(ctx.artifactRoot, envRoot);
                assert.ok(!fs.existsSync(path.join(base, 'llmem')));
            },
        );
    } finally {
        fs.rmSync(ws, { recursive: true, force: true });
        fs.rmSync(base, { recursive: true, force: true });
        fs.rmSync(envRoot, { recursive: true, force: true });
    }
});
