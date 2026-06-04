// tests/unit/install/claude-desktop.test.ts
//
// LI-07 — unit coverage for the Claude Desktop client adapter
// (src/install/claude-desktop.ts).
//
// Claude Desktop is PHASE-2: it is NOT project-aware, so the adapter ALWAYS
// bakes `env.LLMEM_WORKSPACE` into the `mcpServers.llmem` registration —
// pinning `opts.workspace` when supplied, else auto-detecting from the cwd
// (with a warning). The merge surface (read → mergeJsonServer → write) is the
// golden-tested path against tests/unit/install/fixtures/claude-desktop.expected.json.
//
// Per-OS config path (verified against Claude Desktop MCP docs as of 2026-06):
//   - macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json
//   - Windows: %APPDATA%\Claude\claude_desktop_config.json
//   - Linux:   ~/.config/Claude/claude_desktop_config.json
//
// There is no live Claude Desktop in CI, so writes are driven at a temp dir
// via injected platform/env/home + a real-fs io seam so the real config is
// never touched.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    createClaudeDesktopAdapter,
    resolveDesktopDir,
    type DesktopFsIo,
    type ClaudeDesktopSeams,
} from '../../../src/install/claude-desktop';
import type { ApplyOpts, Payload } from '../../../src/install/types';

const FIXTURE = path.resolve(__dirname, 'fixtures/claude-desktop.expected.json');

// npx-form payload (no env) — the adapter must BAKE env.LLMEM_WORKSPACE.
const PAYLOAD: Payload = { command: 'npx', args: ['-y', '@cogeor/llmem', 'mcp'] };

const WORKSPACE = '/work/space';
const OPTS: ApplyOpts = { force: false, scope: 'user', workspace: WORKSPACE };

/** A fresh temp dir that stands in for APPDATA (win32) or HOME (posix). */
function tempBase(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-desktop-'));
}

/** Real-fs io seam (so we exercise actual read/merge/write). */
const realIo: DesktopFsIo = {
    readFile: (p) => fs.promises.readFile(p, 'utf8'),
    writeFile: (p, data) => fs.promises.writeFile(p, data, 'utf8'),
    mkdir: (p) => fs.promises.mkdir(p, { recursive: true }).then(() => undefined),
};

/**
 * Adapter wired to a temp Linux config root (`<base>/.config/Claude/...`) with
 * a no-op warn by default and the real-fs io seam.
 */
function linuxAdapter(base: string, extra: Partial<ClaudeDesktopSeams> = {}) {
    return createClaudeDesktopAdapter({
        platformOf: () => 'linux',
        homeOf: () => base,
        io: realIo,
        warn: () => {},
        ...extra,
    });
}

const linuxConfigFor = (base: string) =>
    path.join(base, '.config', 'Claude', 'claude_desktop_config.json');

// ---------------------------------------------------------------------------
// Per-OS path resolution (injected platform/env)
// ---------------------------------------------------------------------------

test('resolveDesktopDir: macOS → ~/Library/Application Support/Claude', () => {
    const dir = resolveDesktopDir('darwin', {}, () => '/Users/me');
    // path.join uses host separators; assert on the segment sequence.
    assert.equal(
        dir,
        path.join('/Users/me', 'Library', 'Application Support', 'Claude'),
    );
});

test('resolveDesktopDir: Windows → %APPDATA%\\Claude', () => {
    const dir = resolveDesktopDir(
        'win32',
        { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' } as NodeJS.ProcessEnv,
        () => 'C:\\Users\\me',
    );
    assert.equal(dir, path.join('C:\\Users\\me\\AppData\\Roaming', 'Claude'));
});

test('resolveDesktopDir: Linux → ~/.config/Claude', () => {
    const dir = resolveDesktopDir('linux', {}, () => '/home/u');
    assert.equal(dir, path.join('/home/u', '.config', 'Claude'));
});

test('resolveDesktopDir: win32 without APPDATA → null', () => {
    const dir = resolveDesktopDir('win32', {} as NodeJS.ProcessEnv, () => '/home/u');
    assert.equal(dir, null);
});

test('resolveDesktopDir: posix without home → null', () => {
    const dir = resolveDesktopDir('linux', {}, () => undefined);
    assert.equal(dir, null);
});

// ---------------------------------------------------------------------------
// apply — golden fixture (with baked env) + idempotency + force
// ---------------------------------------------------------------------------

test('apply: writes mcpServers.llmem with baked env, matching the golden fixture', async () => {
    const base = tempBase();
    const adapter = linuxAdapter(base);

    const res = await adapter.apply(PAYLOAD, OPTS);
    assert.equal(res.status, 'added');

    const written = fs.readFileSync(linuxConfigFor(base), 'utf8');
    const expected = fs.readFileSync(FIXTURE, 'utf8');
    assert.equal(written, expected);
});

test('apply: creates the Claude/ parent dir when absent', async () => {
    const base = tempBase();
    assert.equal(fs.existsSync(path.join(base, '.config', 'Claude')), false);

    const adapter = linuxAdapter(base);
    const res = await adapter.apply(PAYLOAD, OPTS);
    assert.equal(res.status, 'added');
    assert.equal(fs.existsSync(linuxConfigFor(base)), true);
});

test('apply: re-run is a no-op (status skipped), file unchanged', async () => {
    const base = tempBase();
    const adapter = linuxAdapter(base);

    await adapter.apply(PAYLOAD, OPTS);
    const after1 = fs.readFileSync(linuxConfigFor(base), 'utf8');

    const res2 = await adapter.apply(PAYLOAD, OPTS);
    assert.equal(res2.status, 'skipped');
    const after2 = fs.readFileSync(linuxConfigFor(base), 'utf8');
    assert.equal(after2, after1);
});

test('apply: --force replaces an existing llmem entry', async () => {
    const base = tempBase();
    const dir = path.join(base, '.config', 'Claude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        linuxConfigFor(base),
        JSON.stringify(
            { mcpServers: { llmem: { command: 'OLD', args: [] } } },
            null,
            2,
        ),
        'utf8',
    );

    const adapter = linuxAdapter(base);
    const res = await adapter.apply(PAYLOAD, { ...OPTS, force: true });
    assert.equal(res.status, 'replaced');

    const doc = JSON.parse(fs.readFileSync(linuxConfigFor(base), 'utf8'));
    assert.equal(doc.mcpServers.llmem.command, 'npx');
    assert.deepEqual(doc.mcpServers.llmem.args, ['-y', '@cogeor/llmem', 'mcp']);
    assert.deepEqual(doc.mcpServers.llmem.env, { LLMEM_WORKSPACE: WORKSPACE });
});

test('apply: pre-existing unrelated keys/servers are preserved', async () => {
    const base = tempBase();
    const dir = path.join(base, '.config', 'Claude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        linuxConfigFor(base),
        JSON.stringify(
            {
                theme: 'dark',
                mcpServers: { other: { command: 'x', args: [] } },
            },
            null,
            2,
        ),
        'utf8',
    );

    const adapter = linuxAdapter(base);
    const res = await adapter.apply(PAYLOAD, OPTS);
    assert.equal(res.status, 'added');

    const doc = JSON.parse(fs.readFileSync(linuxConfigFor(base), 'utf8'));
    assert.equal(doc.theme, 'dark');
    assert.deepEqual(doc.mcpServers.other, { command: 'x', args: [] });
    assert.deepEqual(doc.mcpServers.llmem.env, { LLMEM_WORKSPACE: WORKSPACE });
});

test('apply: malformed existing JSON → status error, file NOT clobbered', async () => {
    const base = tempBase();
    const dir = path.join(base, '.config', 'Claude');
    fs.mkdirSync(dir, { recursive: true });
    const garbage = '{ this is : not json';
    fs.writeFileSync(linuxConfigFor(base), garbage, 'utf8');

    const adapter = linuxAdapter(base);
    const res = await adapter.apply(PAYLOAD, OPTS);
    assert.equal(res.status, 'error');
    assert.match(res.detail, /not valid JSON/i);
    assert.equal(fs.readFileSync(linuxConfigFor(base), 'utf8'), garbage);
});

// ---------------------------------------------------------------------------
// missing --workspace → auto-detect + warn (still bakes env)
// ---------------------------------------------------------------------------

test('apply: omitting workspace auto-detects, warns, and still bakes env', async () => {
    const base = tempBase();
    const warnings: string[] = [];
    const adapter = linuxAdapter(base, {
        workspaceOf: () => '/auto/detected',
        warn: (m) => warnings.push(m),
    });

    // No workspace in opts → must auto-detect + warn.
    const res = await adapter.apply(PAYLOAD, { force: false, scope: 'user' });
    assert.equal(res.status, 'added');

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /not project-aware/i);
    assert.match(warnings[0], /\/auto\/detected/);

    const doc = JSON.parse(fs.readFileSync(linuxConfigFor(base), 'utf8'));
    assert.deepEqual(doc.mcpServers.llmem.env, {
        LLMEM_WORKSPACE: '/auto/detected',
    });
});

test('apply: supplying workspace does NOT warn', async () => {
    const base = tempBase();
    const warnings: string[] = [];
    const adapter = linuxAdapter(base, { warn: (m) => warnings.push(m) });

    await adapter.apply(PAYLOAD, OPTS);
    assert.equal(warnings.length, 0);
});

// ---------------------------------------------------------------------------
// snippet writes nothing
// ---------------------------------------------------------------------------

test('snippet returns the mcpServers block and writes nothing', () => {
    const base = tempBase();
    const adapter = linuxAdapter(base);
    const out = adapter.snippet({ ...PAYLOAD, env: { LLMEM_WORKSPACE: WORKSPACE } });
    assert.match(out, /"mcpServers"/);
    assert.match(out, /"llmem"/);
    // Reflects the payload as-given (snippet does not auto-detect).
    assert.equal(out, fs.readFileSync(FIXTURE, 'utf8'));
    // No config file created merely by rendering the snippet.
    assert.equal(fs.existsSync(linuxConfigFor(base)), false);
});

// ---------------------------------------------------------------------------
// detect — config-presence is the signal (no CLI on PATH)
// ---------------------------------------------------------------------------

test('detect: config file present → present via config', async () => {
    const io: DesktopFsIo = {
        readFile: async (p) => {
            if (p.endsWith('claude_desktop_config.json')) return '{}';
            throw Object.assign(new Error('nope'), { code: 'ENOENT' });
        },
        writeFile: async () => {},
        mkdir: async () => {},
    };
    const adapter = createClaudeDesktopAdapter({
        platformOf: () => 'linux',
        homeOf: () => '/home/u',
        io,
    });
    const res = await adapter.detect({} as NodeJS.ProcessEnv);
    assert.equal(res.present, true);
    assert.equal(res.via, 'config');
    assert.equal(
        res.configPath,
        '/home/u/.config/Claude/claude_desktop_config.json',
    );
});

test('detect: no config file → absent', async () => {
    const io: DesktopFsIo = {
        readFile: async () => {
            throw Object.assign(new Error('nope'), { code: 'ENOENT' });
        },
        writeFile: async () => {},
        mkdir: async () => {},
    };
    const adapter = createClaudeDesktopAdapter({
        platformOf: () => 'linux',
        homeOf: () => '/home/u',
        io,
    });
    const res = await adapter.detect({} as NodeJS.ProcessEnv);
    assert.equal(res.present, false);
});

test('detect: win32 resolves the APPDATA config path', async () => {
    const seen: string[] = [];
    const io: DesktopFsIo = {
        readFile: async (p) => {
            seen.push(p);
            throw Object.assign(new Error('nope'), { code: 'ENOENT' });
        },
        writeFile: async () => {},
        mkdir: async () => {},
    };
    const adapter = createClaudeDesktopAdapter({
        platformOf: () => 'win32',
        homeOf: () => 'C:\\Users\\me',
        io,
    });
    const res = await adapter.detect({
        APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
    } as NodeJS.ProcessEnv);
    assert.equal(res.present, false);
    assert.equal(seen.length, 1);
    assert.match(seen[0], /Roaming[\\/]Claude[\\/]claude_desktop_config\.json$/);
});
