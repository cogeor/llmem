/**
 * Integration test for `bin/llmem init` (loop 07).
 *
 * Each test maps to one documented behavior of the `init` command:
 *   1. Fresh workspace → writes `.llmem/config.toml` with byte-equal contents
 *      to the exported `CONFIG_TOML` constant. Exit 0, success message on
 *      stdout.
 *   2. Existing file without `--force` → exits 1, helpful error on stderr,
 *      file untouched (compare bytes before vs. after).
 *   3. `--force` → overwrites a pre-populated stub. Exit 0, file contents
 *      now match `CONFIG_TOML`.
 *
 * Cross-platform notes:
 * - `spawn('node', [BIN, ...])` rather than `spawn(BIN, ...)`. On Windows
 *   the npm `.cmd` wrapper would otherwise be invoked; calling `node`
 *   explicitly bypasses it and tests the actual JS shim end-to-end. Same
 *   convention as `cli-document.test.ts`.
 * - Stdout/stderr normalized via `replace(/\r\n/g, '\n')` before any
 *   string compare so Windows pipe line-ending behavior does not flake.
 * - File-contents comparison normalizes CRLF→LF on the read side too — the
 *   command writes LF, but `git autocrlf=true` could rewrite test fixtures
 *   on a Windows checkout, so be defensive.
 * - Path assertions use forward-slash form (`tmpDir.replaceAll('\\', '/')`)
 *   to match the command's stdout/stderr normalization.
 *
 * Workspace detection: each test creates a tmp dir under `os.tmpdir()`,
 * drops a `package.json` stub there so `detectWorkspace`'s marker walk
 * lands on the tmp dir, then invokes `init --workspace <tmp>` (explicit
 * for safety, even though the marker would suffice).
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { CONFIG_TOML } from '../../../src/claude/cli/commands/init';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'llmem');
const DIST_MAIN = path.join(REPO_ROOT, 'dist', 'claude', 'cli', 'main.js');

function ensureBuilt(): void {
    if (!fs.existsSync(DIST_MAIN)) {
        throw new Error(
            `Expected ${DIST_MAIN} to exist. Run \`npm run build:claude\` before \`npm run test:integration\`.`,
        );
    }
}

function normalize(s: string): string {
    return s.replace(/\r\n/g, '\n');
}

function mkTmp(): string {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-init-'));
    // Drop a marker so detectWorkspace's marker walk lands here even
    // without the explicit --workspace flag (defensive — we still pass
    // --workspace for clarity).
    fs.writeFileSync(path.join(tmp, 'package.json'), '{}', 'utf8');
    return tmp;
}

function rmTmp(tmp: string): void {
    try {
        fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
        // Best-effort — Windows file watchers can delay release.
    }
}

function runInit(cwd: string, extra: string[] = []): {
    status: number | null;
    stdout: string;
    stderr: string;
} {
    const result = spawnSync('node', [BIN, 'init', '--workspace', cwd, ...extra], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '0', LOG_LEVEL: 'error' },
    });
    return {
        status: result.status,
        stdout: normalize(result.stdout ?? ''),
        stderr: normalize(result.stderr ?? ''),
    };
}

// ----------------------------------------------------------------------------
// Test 1 — fresh workspace writes the stub
// ----------------------------------------------------------------------------

test('init: fresh workspace writes .llmem/config.toml byte-equal to CONFIG_TOML', () => {
    ensureBuilt();
    const tmp = mkTmp();
    try {
        const { status, stdout, stderr } = runInit(tmp);

        assert.equal(status, 0, `expected exit 0; stderr=${stderr}\nstdout=${stdout}`);

        const configPath = path.join(tmp, '.llmem', 'config.toml');
        assert.ok(
            fs.existsSync(configPath),
            `expected ${configPath} to exist after init`,
        );

        // Forward-slash normalize for stdout assertion (matches command
        // output, stable across Windows / POSIX).
        const expectedDisplay = configPath.replaceAll('\\', '/');
        assert.ok(
            stdout.includes(`Wrote ${expectedDisplay}`),
            `stdout should announce the written path; got:\n${stdout}`,
        );

        // File contents byte-equal CONFIG_TOML. Normalize CRLF→LF on the
        // read side defensively against `git autocrlf=true` rewrites.
        const written = normalize(fs.readFileSync(configPath, 'utf8'));
        assert.equal(
            written,
            CONFIG_TOML,
            'written file must be byte-equal to CONFIG_TOML',
        );
    } finally {
        rmTmp(tmp);
    }
});

// ----------------------------------------------------------------------------
// Test 2 — refuses to overwrite without --force
// ----------------------------------------------------------------------------

test('init: refuses to overwrite an existing config.toml without --force', () => {
    ensureBuilt();
    const tmp = mkTmp();
    try {
        // First run creates the file.
        const first = runInit(tmp);
        assert.equal(first.status, 0, `first run should succeed; stderr=${first.stderr}`);

        const configPath = path.join(tmp, '.llmem', 'config.toml');
        const before = fs.readFileSync(configPath, 'utf8');

        // Second run without --force must refuse.
        const second = runInit(tmp);
        assert.equal(
            second.status, 1,
            `expected exit 1 on second run; stdout=${second.stdout}\nstderr=${second.stderr}`,
        );
        assert.ok(
            second.stderr.includes('already exists. Use --force to overwrite.'),
            `stderr should contain the helpful overwrite message; got:\n${second.stderr}`,
        );

        // File bytes unchanged.
        const after = fs.readFileSync(configPath, 'utf8');
        assert.equal(before, after, 'refusal must not modify the file');
    } finally {
        rmTmp(tmp);
    }
});

// ----------------------------------------------------------------------------
// Test 3 — --force overwrites a pre-populated stub
// ----------------------------------------------------------------------------

test('init: --force overwrites an existing config.toml', () => {
    ensureBuilt();
    const tmp = mkTmp();
    try {
        // Pre-populate with stale content.
        const dir = path.join(tmp, '.llmem');
        fs.mkdirSync(dir, { recursive: true });
        const configPath = path.join(dir, 'config.toml');
        fs.writeFileSync(configPath, '# stale\n', 'utf8');

        const { status, stdout, stderr } = runInit(tmp, ['--force']);
        assert.equal(status, 0, `expected exit 0; stdout=${stdout}\nstderr=${stderr}`);

        const written = normalize(fs.readFileSync(configPath, 'utf8'));
        assert.equal(
            written,
            CONFIG_TOML,
            '--force must replace the file with CONFIG_TOML',
        );
    } finally {
        rmTmp(tmp);
    }
});
