// tests/unit/install/claude-code.test.ts
//
// LI-04 — unit coverage for the Claude Code client adapter
// (src/install/claude-code.ts).
//
// The native `claude mcp add` path CANNOT run in CI (no `claude` binary), so it
// is manual-smoke only. Every test here injects the PATH probe seam to force
// `claude` ABSENT, deterministically taking the project-local `.mcp.json`
// fallback — the only golden-tested write path. The fs seam points at a real
// temp dir so we exercise actual read/merge/write without touching the user's
// home or a real `claude` install.
//
// Golden fixture: tests/unit/install/fixtures/claude-code.expected.json captures
// the verified `.mcp.json` shape `{ mcpServers: { llmem: { command, args } } }`
// for the npx-form payload. Format verified against Claude Code MCP docs as of
// 2026-06.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    createClaudeCodeAdapter,
    type FsIo,
    type ClaudeCodeSeams,
} from '../../../src/install/claude-code';
import type { ApplyOpts, Payload } from '../../../src/install/types';

const FIXTURE = path.resolve(__dirname, 'fixtures/claude-code.expected.json');

// npx-form payload — matches the golden fixture.
const PAYLOAD: Payload = { command: 'npx', args: ['-y', '@cogeor/llmem', 'mcp'] };

const OPTS: ApplyOpts = { force: false, scope: 'project' };

/** A fresh temp workspace dir, auto-cleaned by the OS / GC of the test run. */
function tempWorkspace(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-cc-'));
}

/** Real-fs io seam (so we exercise actual read/merge/write). */
const realIo: FsIo = {
    readFile: (p) => fs.promises.readFile(p, 'utf8'),
    writeFile: (p, data) => fs.promises.writeFile(p, data, 'utf8'),
};

/** Adapter wired to take the fallback path (claude absent) at a temp root. */
function fallbackAdapter(root: string, extra: Partial<ClaudeCodeSeams> = {}) {
    return createClaudeCodeAdapter({
        pathProbe: async () => false, // force `claude` absent → fallback
        workspaceOf: () => root,
        io: realIo,
        ...extra,
    });
}

// ---------------------------------------------------------------------------
// snippet / golden fixture
// ---------------------------------------------------------------------------

test('snippet(payload) matches the golden .mcp.json fixture', () => {
    const adapter = createClaudeCodeAdapter();
    const snippet = adapter.snippet(PAYLOAD);
    const expected = fs.readFileSync(FIXTURE, 'utf8');
    assert.deepEqual(JSON.parse(snippet), JSON.parse(expected));
});

test("apply fallback merge output equals the golden fixture's shape", async () => {
    const root = tempWorkspace();
    const adapter = fallbackAdapter(root);

    const res = await adapter.apply(PAYLOAD, OPTS);
    assert.equal(res.status, 'added');

    const written = fs.readFileSync(path.join(root, '.mcp.json'), 'utf8');
    const expected = fs.readFileSync(FIXTURE, 'utf8');
    assert.deepEqual(JSON.parse(written), JSON.parse(expected));
});

// ---------------------------------------------------------------------------
// fallback: add → idempotent skip
// ---------------------------------------------------------------------------

test('fallback: apply with no `claude` writes a project .mcp.json with the llmem server', async () => {
    const root = tempWorkspace();
    const adapter = fallbackAdapter(root);

    const res = await adapter.apply(PAYLOAD, OPTS);
    assert.equal(res.status, 'added');

    const cfg = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8'));
    assert.deepEqual(cfg.mcpServers.llmem, PAYLOAD);
});

test('fallback: re-run is a no-op (status skipped), file unchanged', async () => {
    const root = tempWorkspace();
    const adapter = fallbackAdapter(root);

    await adapter.apply(PAYLOAD, OPTS);
    const after1 = fs.readFileSync(path.join(root, '.mcp.json'), 'utf8');

    const res2 = await adapter.apply(PAYLOAD, OPTS);
    assert.equal(res2.status, 'skipped');
    const after2 = fs.readFileSync(path.join(root, '.mcp.json'), 'utf8');
    assert.equal(after2, after1);
});

test('fallback: existing unrelated mcpServers entries are preserved', async () => {
    const root = tempWorkspace();
    const file = path.join(root, '.mcp.json');
    fs.writeFileSync(
        file,
        JSON.stringify(
            { mcpServers: { other: { command: 'x', args: [] } }, topLevel: 1 },
            null,
            2,
        ),
        'utf8',
    );

    const adapter = fallbackAdapter(root);
    const res = await adapter.apply(PAYLOAD, OPTS);
    assert.equal(res.status, 'added');

    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(cfg.mcpServers.other, { command: 'x', args: [] });
    assert.deepEqual(cfg.mcpServers.llmem, PAYLOAD);
    assert.equal(cfg.topLevel, 1);
});

test('fallback: force replaces an existing llmem entry', async () => {
    const root = tempWorkspace();
    const file = path.join(root, '.mcp.json');
    fs.writeFileSync(
        file,
        JSON.stringify({ mcpServers: { llmem: { command: 'OLD', args: [] } } }, null, 2),
        'utf8',
    );

    const adapter = fallbackAdapter(root);
    const res = await adapter.apply(PAYLOAD, { force: true, scope: 'project' });
    assert.equal(res.status, 'replaced');

    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(cfg.mcpServers.llmem, PAYLOAD);
});

// ---------------------------------------------------------------------------
// malformed existing .mcp.json → error, NOT clobbered
// ---------------------------------------------------------------------------

test('fallback: malformed existing .mcp.json → status error, file NOT clobbered', async () => {
    const root = tempWorkspace();
    const file = path.join(root, '.mcp.json');
    const garbage = '{ this is : not valid json ]';
    fs.writeFileSync(file, garbage, 'utf8');

    const adapter = fallbackAdapter(root);
    const res = await adapter.apply(PAYLOAD, OPTS);
    assert.equal(res.status, 'error');
    assert.match(res.detail, /not valid JSON/i);

    // file left exactly as it was
    assert.equal(fs.readFileSync(file, 'utf8'), garbage);
});

// ---------------------------------------------------------------------------
// --print / snippet writes nothing
// ---------------------------------------------------------------------------

test('snippet writes nothing to disk', () => {
    const root = tempWorkspace();
    const adapter = fallbackAdapter(root);
    const out = adapter.snippet(PAYLOAD);
    assert.ok(out.includes('mcpServers'));
    // no .mcp.json created merely by rendering the snippet
    assert.equal(fs.existsSync(path.join(root, '.mcp.json')), false);
});

// ---------------------------------------------------------------------------
// detect — fallback PATH probe seam
// ---------------------------------------------------------------------------

test('detect: `claude` on PATH → present via path', async () => {
    const adapter = createClaudeCodeAdapter({ pathProbe: async () => true });
    const res = await adapter.detect({} as NodeJS.ProcessEnv);
    assert.deepEqual(res, { present: true, via: 'path' });
});

test('detect: no `claude`, ~/.claude.json present → present via config', async () => {
    const io: FsIo = {
        readFile: async (p) => {
            if (p.endsWith('.claude.json')) return '{}';
            throw Object.assign(new Error('nope'), { code: 'ENOENT' });
        },
        writeFile: async () => {},
    };
    const adapter = createClaudeCodeAdapter({ pathProbe: async () => false, io });
    const res = await adapter.detect({ HOME: '/home/u' } as NodeJS.ProcessEnv);
    assert.equal(res.present, true);
    assert.equal(res.via, 'config');
    assert.equal(res.configPath, '/home/u/.claude.json');
});

test('detect: no `claude`, no config → absent', async () => {
    const io: FsIo = {
        readFile: async () => {
            throw Object.assign(new Error('nope'), { code: 'ENOENT' });
        },
        writeFile: async () => {},
    };
    const adapter = createClaudeCodeAdapter({ pathProbe: async () => false, io });
    const res = await adapter.detect({ HOME: '/home/u' } as NodeJS.ProcessEnv);
    assert.equal(res.present, false);
});
