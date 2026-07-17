// tests/unit/mcp/config-store.test.ts
//
// Pin `applyStoreResolution` (src/mcp/config.ts) — the MCP server's slice of
// the P1 portable-store precedence chain. The MCP surface has no flags, so
// the chain reduces to: LLMEM_ARTIFACT_ROOT > LLMEM_STORE=global (per-user
// store keyed by the workspace root) > default (config untouched).
// `env` is injected — no process.env mutation.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';

import { applyStoreResolution } from '../../../src/mcp/config';
import { resolveGlobalStoreRoot } from '../../../src/workspace/store-location';
import { DEFAULT_CONFIG, ENV_VARS } from '../../../src/config-defaults';

const WS = path.resolve(os.tmpdir(), 'llmem-mcp-store-nonexistent', 'proj');
const BASE = path.resolve(os.tmpdir(), 'llmem-mcp-store-base');

test('applyStoreResolution: no env → config passes through untouched', () => {
    const config = { ...DEFAULT_CONFIG };
    assert.deepEqual(applyStoreResolution(config, WS, {}), config);
});

test('applyStoreResolution: LLMEM_STORE=global routes artifactRoot to the per-user store', () => {
    const env = { [ENV_VARS.STORE]: 'global', [ENV_VARS.STORE_DIR]: BASE };
    const out = applyStoreResolution({ ...DEFAULT_CONFIG }, WS, env);
    assert.equal(out.artifactRoot, resolveGlobalStoreRoot(WS, { env }));
    assert.ok(out.artifactRoot.startsWith(path.join(BASE, 'llmem', 'store')));
    // Non-artifactRoot fields are preserved.
    assert.equal(out.maxFileLines, DEFAULT_CONFIG.maxFileLines);
});

test('applyStoreResolution: LLMEM_ARTIFACT_ROOT beats LLMEM_STORE=global', () => {
    const envRoot = path.resolve(os.tmpdir(), 'llmem-mcp-env-root');
    const out = applyStoreResolution({ ...DEFAULT_CONFIG, artifactRoot: envRoot }, WS, {
        [ENV_VARS.ARTIFACT_ROOT]: envRoot,
        [ENV_VARS.STORE]: 'global',
        [ENV_VARS.STORE_DIR]: BASE,
    });
    assert.equal(out.artifactRoot, envRoot);
});

test('applyStoreResolution: junk LLMEM_STORE values are ignored', () => {
    const config = { ...DEFAULT_CONFIG };
    assert.deepEqual(
        applyStoreResolution(config, WS, { [ENV_VARS.STORE]: 'banana' }),
        config,
    );
});
