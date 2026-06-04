// tests/unit/install/registration.test.ts
//
// LI-02 — unit coverage for the pure install registration helpers
// (LI-01: src/install/registration.ts). Everything here is fs-free and
// adapter-free: buildPayload's PATH branch is driven through the injected
// probe seam, and the merge helpers are exercised purely on in-memory
// objects / strings.
//
// Two invariants these tests fail loudly on:
//   - mergeJsonServer MUST NOT mutate its input (a later --print of the
//     caller's parsed JSON must stay pristine).
//   - neither merge helper may drop unrelated entries / tables / keys.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildPayload,
    mergeJsonServer,
    mergeTomlServer,
} from '../../../src/install/registration';
import type { Payload } from '../../../src/install/types';

// ---------------------------------------------------------------------------
// buildPayload
// ---------------------------------------------------------------------------

test('buildPayload: global llmem on PATH → offline-safe { command: llmem, args: [mcp] }', async () => {
    const probe = async (name: string) => {
        assert.equal(name, 'llmem');
        return true;
    };
    const payload = await buildPayload({}, probe);
    assert.deepEqual(payload, { command: 'llmem', args: ['mcp'] });
    assert.equal(payload.env, undefined);
});

test('buildPayload: no global binary → npx fallback', async () => {
    const probe = async () => false;
    const payload = await buildPayload({}, probe);
    assert.deepEqual(payload, {
        command: 'npx',
        args: ['-y', '@cogeor/llmem', 'mcp'],
    });
    assert.equal(payload.env, undefined);
});

test('buildPayload: workspace set → env.LLMEM_WORKSPACE present (global form)', async () => {
    const payload = await buildPayload({ workspace: '/work/space' }, async () => true);
    assert.deepEqual(payload, {
        command: 'llmem',
        args: ['mcp'],
        env: { LLMEM_WORKSPACE: '/work/space' },
    });
});

test('buildPayload: workspace set → env.LLMEM_WORKSPACE present (npx form)', async () => {
    const payload = await buildPayload({ workspace: '/work/space' }, async () => false);
    assert.deepEqual(payload, {
        command: 'npx',
        args: ['-y', '@cogeor/llmem', 'mcp'],
        env: { LLMEM_WORKSPACE: '/work/space' },
    });
});

test('buildPayload: no workspace → no env key at all', async () => {
    const payload = await buildPayload({}, async () => true);
    assert.equal('env' in payload, false);
});

// ---------------------------------------------------------------------------
// mergeJsonServer
// ---------------------------------------------------------------------------

const PAYLOAD: Payload = { command: 'llmem', args: ['mcp'] };

test('mergeJsonServer: add when absent', () => {
    const cfg = { mcpServers: { other: { command: 'x', args: [] } }, topLevel: 1 };
    const { next, status } = mergeJsonServer(cfg, 'llmem', PAYLOAD, false);

    assert.equal(status, 'added');
    assert.deepEqual((next.mcpServers as Record<string, unknown>).llmem, {
        command: 'llmem',
        args: ['mcp'],
    });
    // unrelated entries + sibling keys preserved
    assert.deepEqual((next.mcpServers as Record<string, unknown>).other, {
        command: 'x',
        args: [],
    });
    assert.equal(next.topLevel, 1);
});

test('mergeJsonServer: add when no mcpServers map exists at all', () => {
    const cfg = { somethingElse: true };
    const { next, status } = mergeJsonServer(cfg, 'llmem', PAYLOAD, false);
    assert.equal(status, 'added');
    assert.deepEqual((next.mcpServers as Record<string, unknown>).llmem, {
        command: 'llmem',
        args: ['mcp'],
    });
    assert.equal(next.somethingElse, true);
});

test('mergeJsonServer: replace when present + force', () => {
    const cfg = {
        mcpServers: {
            llmem: { command: 'OLD', args: ['old'] },
            other: { command: 'x', args: [] },
        },
    };
    const { next, status } = mergeJsonServer(cfg, 'llmem', PAYLOAD, true);
    assert.equal(status, 'replaced');
    assert.deepEqual((next.mcpServers as Record<string, unknown>).llmem, {
        command: 'llmem',
        args: ['mcp'],
    });
    assert.deepEqual((next.mcpServers as Record<string, unknown>).other, {
        command: 'x',
        args: [],
    });
});

test('mergeJsonServer: skip when present + !force (input echoed unchanged)', () => {
    const cfg = {
        mcpServers: { llmem: { command: 'OLD', args: ['old'] } },
    };
    const { next, status } = mergeJsonServer(cfg, 'llmem', PAYLOAD, false);
    assert.equal(status, 'skipped');
    assert.deepEqual((next.mcpServers as Record<string, unknown>).llmem, {
        command: 'OLD',
        args: ['old'],
    });
});

test('mergeJsonServer: does NOT mutate the caller input object', () => {
    const cfg = {
        mcpServers: { other: { command: 'x', args: [] as string[] } },
        sibling: { nested: [1, 2, 3] },
    };
    const snapshot = JSON.stringify(cfg);

    const withEnv: Payload = { command: 'llmem', args: ['mcp'], env: { LLMEM_WORKSPACE: '/w' } };
    const { next } = mergeJsonServer(cfg, 'llmem', withEnv, false);

    // input untouched
    assert.equal(JSON.stringify(cfg), snapshot);
    // and the result is a genuinely separate object graph
    (next.mcpServers as Record<string, unknown>).other = { command: 'MUTATED', args: [] };
    assert.deepEqual(cfg.mcpServers.other, { command: 'x', args: [] });
    // env carried through + cloned
    assert.deepEqual(
        ((next.mcpServers as Record<string, Record<string, unknown>>).llmem).env,
        { LLMEM_WORKSPACE: '/w' },
    );
});

test('mergeJsonServer: replace + force does not mutate the original entry', () => {
    const cfg = { mcpServers: { llmem: { command: 'OLD', args: ['old'] } } };
    mergeJsonServer(cfg, 'llmem', PAYLOAD, true);
    assert.deepEqual(cfg.mcpServers.llmem, { command: 'OLD', args: ['old'] });
});

// ---------------------------------------------------------------------------
// mergeTomlServer
// ---------------------------------------------------------------------------

test('mergeTomlServer: add to empty text', () => {
    const { next, status } = mergeTomlServer('', 'llmem', PAYLOAD, false);
    assert.equal(status, 'added');
    assert.match(next, /\[mcp_servers\.llmem\]/);
    assert.match(next, /command = "llmem"/);
    // smol-toml renders arrays with inner spacing: `[ "mcp" ]`.
    assert.match(next, /args = \[ "mcp" \]/);
});

test('mergeTomlServer: add preserves unrelated tables/keys', () => {
    const existing = [
        '[general]',
        'theme = "dark"',
        '',
        '[mcp_servers.other]',
        'command = "x"',
        'args = []',
        '',
    ].join('\n');

    const { next, status } = mergeTomlServer(existing, 'llmem', PAYLOAD, false);
    assert.equal(status, 'added');
    // original content survives
    assert.match(next, /\[general\]/);
    assert.match(next, /theme = "dark"/);
    assert.match(next, /\[mcp_servers\.other\]/);
    assert.match(next, /command = "x"/);
    // new table appended
    assert.match(next, /\[mcp_servers\.llmem\]/);
});

test('mergeTomlServer: skip when present + !force (text unchanged)', () => {
    const existing = [
        '[mcp_servers.llmem]',
        'command = "OLD"',
        'args = ["old"]',
    ].join('\n');
    const { next, status } = mergeTomlServer(existing, 'llmem', PAYLOAD, false);
    assert.equal(status, 'skipped');
    assert.equal(next, existing);
});

test('mergeTomlServer: replace when present + force, preserving surrounding tables', () => {
    const existing = [
        '[general]',
        'theme = "dark"',
        '',
        '[mcp_servers.llmem]',
        'command = "OLD"',
        'args = ["old"]',
        '',
        '[mcp_servers.other]',
        'command = "x"',
        'args = []',
    ].join('\n');

    const { next, status } = mergeTomlServer(existing, 'llmem', PAYLOAD, true);
    assert.equal(status, 'replaced');
    // new value in
    assert.match(next, /command = "llmem"/);
    assert.match(next, /args = \[ "mcp" \]/);
    // old value gone
    assert.equal(/command = "OLD"/.test(next), false);
    // surrounding tables/keys preserved
    assert.match(next, /\[general\]/);
    assert.match(next, /theme = "dark"/);
    assert.match(next, /\[mcp_servers\.other\]/);
    assert.match(next, /command = "x"/);
});

test('mergeTomlServer: env payload renders an env sub-table', () => {
    const withEnv: Payload = {
        command: 'llmem',
        args: ['mcp'],
        env: { LLMEM_WORKSPACE: '/w' },
    };
    const { next } = mergeTomlServer('', 'llmem', withEnv, false);
    // smol-toml serializes nested objects as sub-tables, not inline tables:
    // `[mcp_servers.llmem.env]` / `LLMEM_WORKSPACE = "/w"`.
    assert.match(next, /\[mcp_servers\.llmem\.env\]/);
    assert.match(next, /LLMEM_WORKSPACE = "\/w"/);
});
