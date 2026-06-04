// tests/unit/install/detect.test.ts
//
// LI-02 — unit coverage for the install detection helpers
// (LI-01: src/install/detect.ts). All probes go through injected seams
// (runner / platform / env / fileExists) so nothing here spawns a real
// `where`/`which` or reads a real HOME.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    commandOnPath,
    configFileExists,
    CLIENT_CONFIG_RELPATHS,
    type CommandRunner,
    type FileExistsFn,
} from '../../../src/install/detect';

// ---------------------------------------------------------------------------
// commandOnPath — both platforms, found and not-found
// ---------------------------------------------------------------------------

test('commandOnPath: win32 uses `where` and reports found', async () => {
    let seen: { cmd: string; args: string[] } | null = null;
    const runner: CommandRunner = async (cmd, args) => {
        seen = { cmd, args };
        return true;
    };
    const found = await commandOnPath('llmem', runner, 'win32');
    assert.equal(found, true);
    assert.deepEqual(seen, { cmd: 'where', args: ['llmem'] });
});

test('commandOnPath: win32 `where` non-zero exit → not found (false, not throw)', async () => {
    const runner: CommandRunner = async () => false; // mirrors `where` exit 1
    const found = await commandOnPath('llmem', runner, 'win32');
    assert.equal(found, false);
});

test('commandOnPath: posix uses `which` and reports found', async () => {
    let seen: { cmd: string; args: string[] } | null = null;
    const runner: CommandRunner = async (cmd, args) => {
        seen = { cmd, args };
        return true;
    };
    const found = await commandOnPath('llmem', runner, 'linux');
    assert.equal(found, true);
    assert.deepEqual(seen, { cmd: 'which', args: ['llmem'] });
});

test('commandOnPath: posix `which` non-zero exit → not found', async () => {
    const runner: CommandRunner = async () => false;
    const found = await commandOnPath('llmem', runner, 'darwin');
    assert.equal(found, false);
});

// ---------------------------------------------------------------------------
// configFileExists — mocked fs + env, no real HOME reads
// ---------------------------------------------------------------------------

test('configFileExists: returns first existing path, forward-slash normalized', async () => {
    const env = { HOME: 'C:\\Users\\test' } as NodeJS.ProcessEnv;
    const fileExists: FileExistsFn = async (p) =>
        p.replace(/\\/g, '/').endsWith('.codex/config.toml');

    const result = await configFileExists(['.codex/config.toml'], env, fileExists);
    assert.equal(result, 'C:/Users/test/.codex/config.toml');
});

test('configFileExists: returns null when nothing exists', async () => {
    const env = { HOME: '/home/test' } as NodeJS.ProcessEnv;
    const fileExists: FileExistsFn = async () => false;
    const result = await configFileExists(['.claude.json'], env, fileExists);
    assert.equal(result, null);
});

test('configFileExists: prefers HOME, falls back to USERPROFILE', async () => {
    const env = { USERPROFILE: 'D:\\profile' } as NodeJS.ProcessEnv;
    const seen: string[] = [];
    const fileExists: FileExistsFn = async (p) => {
        seen.push(p.replace(/\\/g, '/'));
        return true;
    };
    const result = await configFileExists(['.claude.json'], env, fileExists);
    assert.equal(result, 'D:/profile/.claude.json');
    assert.ok(seen[0].startsWith('D:/profile/'));
});

test('configFileExists: probes candidates in order, stops at first hit', async () => {
    const env = { HOME: '/home/test' } as NodeJS.ProcessEnv;
    const probed: string[] = [];
    const fileExists: FileExistsFn = async (p) => {
        const norm = p.replace(/\\/g, '/');
        probed.push(norm);
        return norm.endsWith('second.json');
    };
    const result = await configFileExists(
        ['first.json', 'second.json', 'third.json'],
        env,
        fileExists,
    );
    assert.equal(result, '/home/test/second.json');
    // third candidate never probed
    assert.equal(probed.length, 2);
});

test('CLIENT_CONFIG_RELPATHS: known clients have at least one candidate', () => {
    assert.ok(CLIENT_CONFIG_RELPATHS.codex.length >= 1);
    assert.ok(CLIENT_CONFIG_RELPATHS.claude.length >= 1);
    assert.ok(CLIENT_CONFIG_RELPATHS['claude-desktop'].length >= 1);
});
