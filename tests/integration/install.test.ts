/**
 * Integration tests for `bin/llmem install` (loops LI-03/04/05).
 *
 * End-to-end behavior across the phase-1 adapters (Claude Code, Codex) driven
 * through the real `bin/llmem` shim, with HOME / USERPROFILE / APPDATA all
 * redirected to a fresh temp dir per test so NOTHING ever touches the real user
 * home. Runs under `npm run test:integration` (`--test-concurrency=1`, which is
 * mandatory here — every test mutates the shared child-process env via a
 * controlled PATH and the temp home).
 *
 * Mirrors `tests/integration/cli/cli-init.test.ts`:
 *   - `spawnSync('node', [BIN, ...])` (never `spawnSync(BIN, ...)`) so the npm
 *     `.cmd` wrapper is bypassed and we test the actual JS shim end-to-end.
 *   - stdout/stderr normalized CRLF→LF before any string compare.
 *   - forward-slash path assertions (the command normalizes its path output).
 *   - an `ensureBuilt()` guard on `dist/cli/main.js`.
 *
 * Controlled PATH (BLINDSPOT): we keep ONLY the directory containing the
 * running `node` executable on the child's PATH so spawned `node` still
 * resolves, but neither `claude` nor `codex` is found. Combined with a fresh
 * temp HOME (no seeded client config), this makes:
 *   - the Claude Code adapter take its `.mcp.json` fallback path (no native
 *     `claude` CLI), and
 *   - the "no client detected" auto-detect scenario genuinely have neither
 *     client present (no PATH binary AND no config file).
 * `buildPayload` only PROBES PATH for a global `llmem` (also absent here ⇒ the
 * `npx` payload form), and the adapters never spawn `npx`, so a minimal PATH is
 * safe.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

const REPO_ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'llmem');
const DIST_MAIN = path.join(REPO_ROOT, 'dist', 'cli', 'main.js');

/** Directory holding the running `node` — the only entry we keep on the child
 *  PATH so `node` resolves but `claude` / `codex` do not. */
const NODE_DIR = path.dirname(process.execPath);

function ensureBuilt(): void {
    if (!fs.existsSync(DIST_MAIN)) {
        throw new Error(
            `Expected ${DIST_MAIN} to exist. Run \`npm run build:entrypoints\` before \`npm run test:integration\`.`,
        );
    }
}

function normalize(s: string): string {
    return s.replace(/\r\n/g, '\n');
}

/** Forward-slash form for path assertions against the command's output. */
function fwd(p: string): string {
    return p.replaceAll('\\', '/');
}

interface TmpEnv {
    /** Temp home (HOME/USERPROFILE point here; ~/.codex lives under it). */
    home: string;
    /** Temp APPDATA (Codex/Desktop read this on Windows). */
    appData: string;
    /** A temp project dir with a package.json marker for detectWorkspace. */
    project: string;
}

function mkTmpEnv(): TmpEnv {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-install-'));
    const appData = path.join(home, 'AppData');
    fs.mkdirSync(appData, { recursive: true });
    const project = path.join(home, 'proj');
    fs.mkdirSync(project, { recursive: true });
    // Marker so detectWorkspace lands inside the temp project.
    fs.writeFileSync(path.join(project, 'package.json'), '{}', 'utf8');
    return { home, appData, project };
}

function rmTmp(p: string): void {
    try {
        fs.rmSync(p, { recursive: true, force: true });
    } catch {
        // Best-effort — Windows file locks can delay release.
    }
}

/**
 * Run `node bin/llmem install <args...>` with HOME/USERPROFILE/APPDATA
 * redirected at `tmp` and a controlled PATH (node dir only).
 */
function runInstall(tmp: TmpEnv, args: string[]): {
    status: number | null;
    stdout: string;
    stderr: string;
} {
    const result = spawnSync('node', [BIN, 'install', ...args], {
        cwd: tmp.project,
        encoding: 'utf8',
        env: {
            // Deliberately a MINIMAL env — no inherited PATH so neither
            // `claude` nor `codex` (nor a global `llmem`) is discoverable.
            HOME: tmp.home,
            USERPROFILE: tmp.home,
            APPDATA: tmp.appData,
            PATH: NODE_DIR,
            Path: NODE_DIR, // Windows is case-insensitive but be explicit.
            SystemRoot: process.env.SystemRoot ?? '',
            FORCE_COLOR: '0',
            LOG_LEVEL: 'error',
        },
    });
    return {
        status: result.status,
        stdout: normalize(result.stdout ?? ''),
        stderr: normalize(result.stderr ?? ''),
    };
}

/** Recursively snapshot every file path + content under a dir (sorted). */
function snapshotTree(root: string): string {
    const entries: string[] = [];
    function walk(dir: string): void {
        for (const name of fs.readdirSync(dir).sort()) {
            const full = path.join(dir, name);
            const st = fs.statSync(full);
            if (st.isDirectory()) {
                entries.push(`D ${fwd(path.relative(root, full))}`);
                walk(full);
            } else {
                const content = fs.readFileSync(full, 'utf8');
                entries.push(`F ${fwd(path.relative(root, full))}\n${content}`);
            }
        }
    }
    walk(root);
    return entries.join('\n---\n');
}

// ----------------------------------------------------------------------------
// Codex — add, idempotent re-run, --force replace, unrelated TOML preserved
// ----------------------------------------------------------------------------

test('install codex: writes [mcp_servers.llmem], idempotent re-run, --force replaces, unrelated TOML preserved', () => {
    ensureBuilt();
    const tmp = mkTmpEnv();
    try {
        // Seed an existing ~/.codex/config.toml with an UNRELATED table to
        // prove the merge preserves it.
        const codexDir = path.join(tmp.home, '.codex');
        fs.mkdirSync(codexDir, { recursive: true });
        const codexConfig = path.join(codexDir, 'config.toml');
        fs.writeFileSync(
            codexConfig,
            '[some_unrelated_table]\nkey = "value"\n',
            'utf8',
        );

        // --- add ---
        const first = runInstall(tmp, ['codex', '--workspace', tmp.project]);
        assert.equal(
            first.status, 0,
            `expected exit 0; stderr=${first.stderr}\nstdout=${first.stdout}`,
        );
        assert.ok(
            first.stdout.includes('Codex: added'),
            `stdout should report Codex added; got:\n${first.stdout}`,
        );

        let toml = normalize(fs.readFileSync(codexConfig, 'utf8'));
        assert.ok(
            toml.includes('[mcp_servers.llmem]'),
            `config.toml should register llmem; got:\n${toml}`,
        );
        assert.ok(
            toml.includes('[some_unrelated_table]') && toml.includes('key = "value"'),
            `unrelated table must be preserved; got:\n${toml}`,
        );

        // --- idempotent re-run (no --force ⇒ skipped, file byte-stable) ---
        const before = fs.readFileSync(codexConfig, 'utf8');
        const second = runInstall(tmp, ['codex', '--workspace', tmp.project]);
        assert.equal(second.status, 0, `re-run should exit 0; stderr=${second.stderr}`);
        assert.ok(
            second.stdout.includes('Codex: skipped'),
            `re-run should report skipped; got:\n${second.stdout}`,
        );
        const after = fs.readFileSync(codexConfig, 'utf8');
        assert.equal(before, after, 'idempotent re-run must not modify the file');

        // --- --force ⇒ replaced ---
        const forced = runInstall(tmp, ['codex', '--workspace', tmp.project, '--force']);
        assert.equal(forced.status, 0, `--force should exit 0; stderr=${forced.stderr}`);
        assert.ok(
            forced.stdout.includes('Codex: replaced'),
            `--force should report replaced; got:\n${forced.stdout}`,
        );
        toml = normalize(fs.readFileSync(codexConfig, 'utf8'));
        assert.ok(
            toml.includes('[mcp_servers.llmem]') && toml.includes('[some_unrelated_table]'),
            `after --force both tables must remain; got:\n${toml}`,
        );
    } finally {
        rmTmp(tmp.home);
    }
});

// ----------------------------------------------------------------------------
// Claude Code — forced fallback to project .mcp.json, idempotent re-run
// ----------------------------------------------------------------------------

test('install claude: falls back to project .mcp.json (no claude on PATH), idempotent re-run', () => {
    ensureBuilt();
    const tmp = mkTmpEnv();
    try {
        // No `claude` on the controlled PATH ⇒ fallback path writes a
        // project-local .mcp.json in the detected workspace.
        const first = runInstall(tmp, ['claude', '--workspace', tmp.project]);
        assert.equal(
            first.status, 0,
            `expected exit 0; stderr=${first.stderr}\nstdout=${first.stdout}`,
        );
        assert.ok(
            first.stdout.includes('Claude Code: added'),
            `stdout should report Claude Code added; got:\n${first.stdout}`,
        );

        const mcpJson = path.join(tmp.project, '.mcp.json');
        assert.ok(fs.existsSync(mcpJson), `expected ${mcpJson} to be written`);
        const parsed = JSON.parse(fs.readFileSync(mcpJson, 'utf8'));
        assert.ok(
            parsed.mcpServers && parsed.mcpServers.llmem,
            `.mcp.json must contain mcpServers.llmem; got:\n${JSON.stringify(parsed, null, 2)}`,
        );

        // --- idempotent re-run ---
        const before = fs.readFileSync(mcpJson, 'utf8');
        const second = runInstall(tmp, ['claude', '--workspace', tmp.project]);
        assert.equal(second.status, 0, `re-run should exit 0; stderr=${second.stderr}`);
        assert.ok(
            second.stdout.includes('Claude Code: skipped'),
            `re-run should report skipped; got:\n${second.stdout}`,
        );
        const after = fs.readFileSync(mcpJson, 'utf8');
        assert.equal(before, after, 'idempotent re-run must not modify .mcp.json');
    } finally {
        rmTmp(tmp.home);
    }
});

// ----------------------------------------------------------------------------
// Claude Desktop — per-OS config, baked env.LLMEM_WORKSPACE, idempotent, --force
// ----------------------------------------------------------------------------

/**
 * The per-OS Claude Desktop config path under the redirected temp env. Mirrors
 * `resolveDesktopDir` in the adapter:
 *   - win32:  %APPDATA%\Claude\claude_desktop_config.json
 *   - darwin: ~/Library/Application Support/Claude/claude_desktop_config.json
 *   - linux:  ~/.config/Claude/claude_desktop_config.json
 */
function desktopConfigPath(tmp: TmpEnv): string {
    const FILE = 'claude_desktop_config.json';
    if (process.platform === 'win32') {
        return path.join(tmp.appData, 'Claude', FILE);
    }
    if (process.platform === 'darwin') {
        return path.join(tmp.home, 'Library', 'Application Support', 'Claude', FILE);
    }
    return path.join(tmp.home, '.config', 'Claude', FILE);
}

test('install claude-desktop: writes mcpServers.llmem with baked env.LLMEM_WORKSPACE, idempotent, --force replaces', () => {
    ensureBuilt();
    const tmp = mkTmpEnv();
    try {
        const cfg = desktopConfigPath(tmp);

        // --- add ---
        const first = runInstall(tmp, ['claude-desktop', '--workspace', tmp.project]);
        assert.equal(
            first.status, 0,
            `expected exit 0; stderr=${first.stderr}\nstdout=${first.stdout}`,
        );
        assert.ok(
            first.stdout.includes('Claude Desktop: added'),
            `stdout should report Claude Desktop added; got:\n${first.stdout}`,
        );

        assert.ok(fs.existsSync(cfg), `expected ${cfg} to be written`);
        const parsed = JSON.parse(fs.readFileSync(cfg, 'utf8'));
        assert.ok(
            parsed.mcpServers && parsed.mcpServers.llmem,
            `config must contain mcpServers.llmem; got:\n${JSON.stringify(parsed, null, 2)}`,
        );
        // Phase-2: Desktop ALWAYS bakes env.LLMEM_WORKSPACE.
        assert.equal(
            fwd(parsed.mcpServers.llmem.env.LLMEM_WORKSPACE),
            fwd(tmp.project),
            `Desktop must bake env.LLMEM_WORKSPACE; got:\n${JSON.stringify(parsed, null, 2)}`,
        );

        // --- idempotent re-run (no --force ⇒ skipped, file byte-stable) ---
        const before = fs.readFileSync(cfg, 'utf8');
        const second = runInstall(tmp, ['claude-desktop', '--workspace', tmp.project]);
        assert.equal(second.status, 0, `re-run should exit 0; stderr=${second.stderr}`);
        assert.ok(
            second.stdout.includes('Claude Desktop: skipped'),
            `re-run should report skipped; got:\n${second.stdout}`,
        );
        const after = fs.readFileSync(cfg, 'utf8');
        assert.equal(before, after, 'idempotent re-run must not modify the file');

        // --- --force ⇒ replaced ---
        const forced = runInstall(tmp, ['claude-desktop', '--workspace', tmp.project, '--force']);
        assert.equal(forced.status, 0, `--force should exit 0; stderr=${forced.stderr}`);
        assert.ok(
            forced.stdout.includes('Claude Desktop: replaced'),
            `--force should report replaced; got:\n${forced.stdout}`,
        );
        const reparsed = JSON.parse(fs.readFileSync(cfg, 'utf8'));
        assert.equal(
            fwd(reparsed.mcpServers.llmem.env.LLMEM_WORKSPACE),
            fwd(tmp.project),
        );
    } finally {
        rmTmp(tmp.home);
    }
});

// ----------------------------------------------------------------------------
// --dry-run — zero filesystem writes, exit 0
// ----------------------------------------------------------------------------

test('install --dry-run: writes nothing and exits 0', () => {
    ensureBuilt();
    const tmp = mkTmpEnv();
    try {
        const before = snapshotTree(tmp.home);
        const { status, stdout } = runInstall(tmp, ['codex', '--dry-run', '--workspace', tmp.project]);
        assert.equal(status, 0, `--dry-run should exit 0; stdout=${stdout}`);
        assert.ok(
            stdout.includes('Dry run'),
            `--dry-run should announce itself; got:\n${stdout}`,
        );
        const after = snapshotTree(tmp.home);
        assert.equal(before, after, '--dry-run must not write to the filesystem');
        assert.ok(
            !fs.existsSync(path.join(tmp.home, '.codex', 'config.toml')),
            '--dry-run must not create ~/.codex/config.toml',
        );
    } finally {
        rmTmp(tmp.home);
    }
});

// ----------------------------------------------------------------------------
// --print — zero writes, BOTH snippet forms on stdout, exit 0
// ----------------------------------------------------------------------------

test('install --print: writes nothing, prints both snippet forms, exits 0', () => {
    ensureBuilt();
    const tmp = mkTmpEnv();
    try {
        const before = snapshotTree(tmp.home);
        // No positional + none detected ⇒ generic both-form manual snippets.
        const { status, stdout } = runInstall(tmp, ['--print']);
        assert.equal(status, 0, `--print should exit 0; stdout=${stdout}`);

        // Offline-safe global form: { "command": "llmem", "args": ["mcp"] }.
        assert.ok(
            stdout.includes('"llmem"') && /"mcp"/.test(stdout),
            `--print should show the offline-safe llmem mcp form; got:\n${stdout}`,
        );
        // Network-dependent npx form.
        assert.ok(
            stdout.includes('"npx"') && stdout.includes('@cogeor/llmem'),
            `--print should show the npx fallback form; got:\n${stdout}`,
        );

        const after = snapshotTree(tmp.home);
        assert.equal(before, after, '--print must not write to the filesystem');
    } finally {
        rmTmp(tmp.home);
    }
});

// ----------------------------------------------------------------------------
// Unknown client — exit 1, stderr lists valid names
// ----------------------------------------------------------------------------

test('install fnord: unknown client exits 1 and lists valid names on stderr', () => {
    ensureBuilt();
    const tmp = mkTmpEnv();
    try {
        const { status, stderr } = runInstall(tmp, ['fnord']);
        assert.equal(status, 1, `unknown client should exit 1; stderr=${stderr}`);
        assert.ok(
            stderr.includes('fnord'),
            `stderr should name the unknown client; got:\n${stderr}`,
        );
        for (const valid of ['claude', 'codex', 'claude-desktop']) {
            assert.ok(
                stderr.includes(valid),
                `stderr should list valid client "${valid}"; got:\n${stderr}`,
            );
        }
    } finally {
        rmTmp(tmp.home);
    }
});

// ----------------------------------------------------------------------------
// No client detected + no positional — exit 0 with manual snippets
// ----------------------------------------------------------------------------

test('install (auto-detect, none present): exits 0 with manual snippets on stdout', () => {
    ensureBuilt();
    const tmp = mkTmpEnv();
    try {
        // Fresh temp HOME has no ~/.codex/config.toml and no ~/.claude.json,
        // and the controlled PATH has neither codex nor claude ⇒ truly none.
        const { status, stdout } = runInstall(tmp, ['--workspace', tmp.project]);
        assert.equal(status, 0, `none-detected should exit 0; stdout=${stdout}`);
        assert.ok(
            stdout.includes('No agent clients detected'),
            `should report nothing detected; got:\n${stdout}`,
        );
        // Manual snippets — both forms.
        assert.ok(
            stdout.includes('"llmem"') && stdout.includes('"npx"') && stdout.includes('@cogeor/llmem'),
            `should print both manual snippet forms; got:\n${stdout}`,
        );
        // And it must not have written a codex config.
        assert.ok(
            !fs.existsSync(path.join(tmp.home, '.codex', 'config.toml')),
            'none-detected auto-detect must not write any config',
        );
    } finally {
        rmTmp(tmp.home);
    }
});

// ----------------------------------------------------------------------------
// Idempotent full re-run of auto-detect — already-registered, exit 0
// ----------------------------------------------------------------------------

test('install (auto-detect): full re-run is idempotent (already registered), exit 0', () => {
    ensureBuilt();
    const tmp = mkTmpEnv();
    try {
        // Seed a ~/.codex/config.toml so codex is DETECTED via config (the
        // controlled PATH still finds no codex binary). First auto-detect run
        // registers; the second must skip.
        const codexDir = path.join(tmp.home, '.codex');
        fs.mkdirSync(codexDir, { recursive: true });
        fs.writeFileSync(path.join(codexDir, 'config.toml'), '', 'utf8');

        const first = runInstall(tmp, ['--workspace', tmp.project]);
        assert.equal(first.status, 0, `first auto-detect run should exit 0; stderr=${first.stderr}`);
        assert.ok(
            first.stdout.includes('Codex: added'),
            `first run should add Codex; got:\n${first.stdout}`,
        );

        const second = runInstall(tmp, ['--workspace', tmp.project]);
        assert.equal(second.status, 0, `re-run should exit 0; stderr=${second.stderr}`);
        assert.ok(
            second.stdout.includes('Codex: skipped'),
            `re-run should skip (already registered); got:\n${second.stdout}`,
        );
    } finally {
        rmTmp(tmp.home);
    }
});
