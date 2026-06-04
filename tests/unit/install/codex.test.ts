// tests/unit/install/codex.test.ts
//
// LI-05 — unit coverage for the Codex client adapter
// (src/install/codex.ts) and the real smol-toml-backed
// `mergeTomlServer` it builds on.
//
// Two surfaces:
//   1. mergeTomlServer add/replace/skip + unrelated-table preservation, asserted
//      (for the add case) against the golden fixture
//      tests/unit/install/fixtures/codex.expected.toml.
//   2. The adapter `apply` over a temp HOME (injected via the homeOf seam), with
//      a real-fs io seam pointed at that temp dir: create → idempotent skip →
//      force replace → unrelated-table preservation → malformed-not-clobbered.
//
// There is no `codex` binary in CI, so every adapter test forces `codex` ABSENT
// (it doesn't affect apply, which always writes the TOML) and drives writes at a
// temp HOME so the real `~/.codex` is never touched.
//
// Format verified against Codex config docs as of 2026-06: `~/.codex/config.toml`
// with a `[mcp_servers.llmem]` table (command / args / optional env sub-table).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { parse as parseToml } from 'smol-toml';

import {
    createCodexAdapter,
    type CodexFsIo,
    type CodexSeams,
} from '../../../src/install/codex';
import { mergeTomlServer } from '../../../src/install/registration';
import type { ApplyOpts, Payload } from '../../../src/install/types';

const FIXTURE = path.resolve(__dirname, 'fixtures/codex.expected.toml');

// npx-form payload — matches the golden fixture.
const PAYLOAD: Payload = { command: 'npx', args: ['-y', '@cogeor/llmem', 'mcp'] };

const OPTS: ApplyOpts = { force: false, scope: 'user' };

/** A fresh temp HOME dir. */
function tempHome(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-codex-'));
}

/** Real-fs io seam (so we exercise actual read/merge/write). */
const realIo: CodexFsIo = {
    readFile: (p) => fs.promises.readFile(p, 'utf8'),
    writeFile: (p, data) => fs.promises.writeFile(p, data, 'utf8'),
    mkdir: (p) => fs.promises.mkdir(p, { recursive: true }).then(() => undefined),
};

/** Adapter wired to a temp HOME with `codex` absent on PATH. */
function homeAdapter(home: string, extra: Partial<CodexSeams> = {}) {
    return createCodexAdapter({
        pathProbe: async () => false,
        homeOf: () => home,
        io: realIo,
        ...extra,
    });
}

const configPathFor = (home: string) => path.join(home, '.codex', 'config.toml');

// ---------------------------------------------------------------------------
// mergeTomlServer — add / replace / skip + golden fixture
// ---------------------------------------------------------------------------

test('mergeTomlServer: add to empty doc matches the golden codex fixture', () => {
    const { next, status } = mergeTomlServer('', 'llmem', PAYLOAD, false);
    assert.equal(status, 'added');
    const expected = fs.readFileSync(FIXTURE, 'utf8');
    assert.equal(next, expected);
});

test('mergeTomlServer: replace when present + force', () => {
    const existing = ['[mcp_servers.llmem]', 'command = "OLD"', 'args = []'].join(
        '\n',
    );
    const { next, status } = mergeTomlServer(existing, 'llmem', PAYLOAD, true);
    assert.equal(status, 'replaced');
    const doc = parseToml(next) as {
        mcp_servers: { llmem: { command: string; args: string[] } };
    };
    assert.equal(doc.mcp_servers.llmem.command, 'npx');
    assert.deepEqual(doc.mcp_servers.llmem.args, ['-y', '@cogeor/llmem', 'mcp']);
});

test('mergeTomlServer: skip when present + !force (text byte-for-byte unchanged)', () => {
    const existing = [
        '# my hand-written config',
        '[mcp_servers.llmem]',
        'command = "OLD"',
        'args = ["old"]',
        '',
    ].join('\n');
    const { next, status } = mergeTomlServer(existing, 'llmem', PAYLOAD, false);
    assert.equal(status, 'skipped');
    // Byte-for-byte unchanged — comments preserved on the no-op path.
    assert.equal(next, existing);
});

test('mergeTomlServer: round-trip preserves unrelated tables/keys', () => {
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

    const doc = parseToml(next) as {
        general: { theme: string };
        mcp_servers: {
            other: { command: string; args: string[] };
            llmem: { command: string; args: string[] };
        };
    };
    assert.equal(doc.general.theme, 'dark');
    assert.deepEqual(doc.mcp_servers.other, { command: 'x', args: [] });
    assert.deepEqual(doc.mcp_servers.llmem, {
        command: 'npx',
        args: ['-y', '@cogeor/llmem', 'mcp'],
    });
});

test('mergeTomlServer: env payload round-trips as an env sub-table', () => {
    const withEnv: Payload = {
        command: 'llmem',
        args: ['mcp'],
        env: { LLMEM_WORKSPACE: '/work/space' },
    };
    const { next } = mergeTomlServer('', 'llmem', withEnv, false);
    const doc = parseToml(next) as {
        mcp_servers: { llmem: { env: Record<string, string> } };
    };
    assert.deepEqual(doc.mcp_servers.llmem.env, { LLMEM_WORKSPACE: '/work/space' });
});

test('mergeTomlServer: malformed TOML throws (so the adapter can refuse)', () => {
    assert.throws(() => mergeTomlServer('this is = not [valid', 'llmem', PAYLOAD, false));
});

// ---------------------------------------------------------------------------
// adapter apply — over a temp HOME
// ---------------------------------------------------------------------------

test('apply: creates ~/.codex/config.toml with [mcp_servers.llmem]', async () => {
    const home = tempHome();
    const adapter = homeAdapter(home);

    const res = await adapter.apply(PAYLOAD, OPTS);
    assert.equal(res.status, 'added');

    const written = fs.readFileSync(configPathFor(home), 'utf8');
    const expected = fs.readFileSync(FIXTURE, 'utf8');
    assert.equal(written, expected);
});

test('apply: creates ~/.codex/ dir when absent', async () => {
    const home = tempHome();
    // ~/.codex does not exist yet
    assert.equal(fs.existsSync(path.join(home, '.codex')), false);

    const adapter = homeAdapter(home);
    const res = await adapter.apply(PAYLOAD, OPTS);
    assert.equal(res.status, 'added');
    assert.equal(fs.existsSync(configPathFor(home)), true);
});

test('apply: re-run is a no-op (status skipped), file unchanged', async () => {
    const home = tempHome();
    const adapter = homeAdapter(home);

    await adapter.apply(PAYLOAD, OPTS);
    const after1 = fs.readFileSync(configPathFor(home), 'utf8');

    const res2 = await adapter.apply(PAYLOAD, OPTS);
    assert.equal(res2.status, 'skipped');
    const after2 = fs.readFileSync(configPathFor(home), 'utf8');
    assert.equal(after2, after1);
});

test('apply: --force replaces an existing llmem entry', async () => {
    const home = tempHome();
    const dir = path.join(home, '.codex');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        configPathFor(home),
        ['[mcp_servers.llmem]', 'command = "OLD"', 'args = []', ''].join('\n'),
        'utf8',
    );

    const adapter = homeAdapter(home);
    const res = await adapter.apply(PAYLOAD, { force: true, scope: 'user' });
    assert.equal(res.status, 'replaced');

    const doc = parseToml(fs.readFileSync(configPathFor(home), 'utf8')) as {
        mcp_servers: { llmem: { command: string; args: string[] } };
    };
    assert.equal(doc.mcp_servers.llmem.command, 'npx');
    assert.deepEqual(doc.mcp_servers.llmem.args, ['-y', '@cogeor/llmem', 'mcp']);
});

test('apply: pre-existing unrelated TOML tables/keys are preserved', async () => {
    const home = tempHome();
    const dir = path.join(home, '.codex');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        configPathFor(home),
        [
            '[general]',
            'theme = "dark"',
            '',
            '[mcp_servers.other]',
            'command = "x"',
            'args = []',
            '',
        ].join('\n'),
        'utf8',
    );

    const adapter = homeAdapter(home);
    const res = await adapter.apply(PAYLOAD, OPTS);
    assert.equal(res.status, 'added');

    const doc = parseToml(fs.readFileSync(configPathFor(home), 'utf8')) as {
        general: { theme: string };
        mcp_servers: {
            other: { command: string; args: string[] };
            llmem: { command: string; args: string[] };
        };
    };
    assert.equal(doc.general.theme, 'dark');
    assert.deepEqual(doc.mcp_servers.other, { command: 'x', args: [] });
    assert.deepEqual(doc.mcp_servers.llmem, {
        command: 'npx',
        args: ['-y', '@cogeor/llmem', 'mcp'],
    });
});

test('apply: malformed existing TOML → status error, file NOT clobbered', async () => {
    const home = tempHome();
    const dir = path.join(home, '.codex');
    fs.mkdirSync(dir, { recursive: true });
    const garbage = 'this is = not [valid toml';
    fs.writeFileSync(configPathFor(home), garbage, 'utf8');

    const adapter = homeAdapter(home);
    const res = await adapter.apply(PAYLOAD, OPTS);
    assert.equal(res.status, 'error');
    assert.match(res.detail, /not valid TOML/i);

    // file left exactly as it was
    assert.equal(fs.readFileSync(configPathFor(home), 'utf8'), garbage);
});

// ---------------------------------------------------------------------------
// snippet writes nothing
// ---------------------------------------------------------------------------

test('snippet returns the [mcp_servers.llmem] block and writes nothing', () => {
    const home = tempHome();
    const adapter = homeAdapter(home);
    const out = adapter.snippet(PAYLOAD);
    assert.match(out, /\[mcp_servers\.llmem\]/);
    // matches the golden fixture (snippet uses the same serializer as apply)
    assert.equal(out, fs.readFileSync(FIXTURE, 'utf8'));
    // no config file created merely by rendering the snippet
    assert.equal(fs.existsSync(configPathFor(home)), false);
});

// ---------------------------------------------------------------------------
// detect — PATH + config seams
// ---------------------------------------------------------------------------

test('detect: `codex` on PATH → present via path', async () => {
    const adapter = createCodexAdapter({ pathProbe: async () => true });
    const res = await adapter.detect({} as NodeJS.ProcessEnv);
    assert.deepEqual(res, { present: true, via: 'path' });
});

test('detect: no `codex`, ~/.codex/config.toml present → present via config', async () => {
    const io: CodexFsIo = {
        readFile: async (p) => {
            if (p.endsWith('config.toml')) return '';
            throw Object.assign(new Error('nope'), { code: 'ENOENT' });
        },
        writeFile: async () => {},
        mkdir: async () => {},
    };
    const adapter = createCodexAdapter({
        pathProbe: async () => false,
        homeOf: () => '/home/u',
        io,
    });
    const res = await adapter.detect({} as NodeJS.ProcessEnv);
    assert.equal(res.present, true);
    assert.equal(res.via, 'config');
    assert.equal(res.configPath, '/home/u/.codex/config.toml');
});

test('detect: no `codex`, no config → absent', async () => {
    const io: CodexFsIo = {
        readFile: async () => {
            throw Object.assign(new Error('nope'), { code: 'ENOENT' });
        },
        writeFile: async () => {},
        mkdir: async () => {},
    };
    const adapter = createCodexAdapter({
        pathProbe: async () => false,
        homeOf: () => '/home/u',
        io,
    });
    const res = await adapter.detect({} as NodeJS.ProcessEnv);
    assert.equal(res.present, false);
});
