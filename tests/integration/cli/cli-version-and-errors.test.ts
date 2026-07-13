/**
 * B1 (2026-07-13) — first-five-minutes CLI contract, end-to-end via the shim:
 *   - `llmem --version` / `-V` prints the package semver and exits 0.
 *   - `llmem fnord` (unknown command) exits 1 naming the command (the old
 *     behavior printed help and exited 0 — typos looked like success in CI).
 *   - `llmem serve --prot 8080` (typo'd flag) exits 1 naming `--prot`
 *     (schemas are `.strict()` — unknown flags are no longer silently
 *     ignored).
 *
 * Spawn conventions follow cli-scan.test.ts.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

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

function runCli(
    args: string[],
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn('node', [BIN, ...args], {
            cwd: REPO_ROOT,
            env: { ...process.env, FORCE_COLOR: '0' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        child.stdout!.on('data', (c: Buffer) => { stdout += c.toString('utf8'); });
        child.stderr!.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });

        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`llmem ${args.join(' ')} timed out; out:\n${stdout}\nerr:\n${stderr}`));
        }, 30_000);

        child.once('exit', (code) => {
            clearTimeout(timer);
            resolve({ exitCode: code, stdout, stderr });
        });
        child.once('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

test('llmem --version prints the package semver and exits 0', async () => {
    ensureBuilt();
    const pkg = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
    ) as { version: string };

    const { exitCode, stdout } = await runCli(['--version']);
    assert.equal(exitCode, 0);
    assert.equal(stdout.trim(), pkg.version, `expected bare semver, got: ${stdout}`);
    assert.match(stdout.trim(), /^\d+\.\d+\.\d+/, 'looks like a semver');

    const short = await runCli(['-V']);
    assert.equal(short.exitCode, 0);
    assert.equal(short.stdout.trim(), pkg.version);
});

test('llmem fnord exits 1 and names the unknown command', async () => {
    ensureBuilt();
    const { exitCode, stdout, stderr } = await runCli(['fnord']);
    assert.equal(exitCode, 1, `unknown command must exit 1; out:\n${stdout}`);
    assert.match(
        stderr,
        /Unknown command 'fnord'/,
        `stderr names the command; got:\n${stderr}`,
    );
    assert.match(stderr, /llmem --help/, 'points at --help');
});

test('llmem serve --prot 8080 exits 1 naming the unknown flag', async () => {
    ensureBuilt();
    const { exitCode, stderr } = await runCli(['serve', '--prot', '8080']);
    assert.equal(exitCode, 1, `typo'd flag must exit 1; stderr:\n${stderr}`);
    assert.match(
        stderr,
        /unknown option --prot/,
        `stderr names the flag the user typed; got:\n${stderr}`,
    );
});

// B2 — the two help surfaces.
test('llmem health --help is command-scoped: names --fail-on, omits other commands', async () => {
    ensureBuilt();
    const { exitCode, stdout } = await runCli(['health', '--help']);
    assert.equal(exitCode, 0);
    assert.match(stdout, /llmem health — /, 'command header present');
    assert.match(stdout, /--fail-on/, `health flags listed:\n${stdout}`);
    assert.ok(!stdout.includes('install '), `no other commands on the page:\n${stdout}`);
});

test('llmem --help: honest header, llmem-first examples, no npm run serve', async () => {
    ensureBuilt();
    const { exitCode, stdout } = await runCli(['--help']);
    assert.equal(exitCode, 0);
    assert.match(
        stdout,
        /LLMem — dependency graphs, health reports, and AI architecture review/,
        `new title:\n${stdout}`,
    );
    assert.match(stdout, /llmem health/, 'health example present');
    assert.ok(!stdout.includes('npm run serve'), `npm-run examples dropped:\n${stdout}`);
    // C2: find-cycles is a hidden alias — absent from the command list.
    assert.ok(!stdout.includes('find-cycles'), `find-cycles hidden from help:\n${stdout}`);
});

test('llmem scan with a stray positional exits 1 with unexpected-argument', async () => {
    ensureBuilt();
    // `scan` takes --folder, not a positional; before .strict() the stray
    // positional was silently ignored.
    const { exitCode, stderr } = await runCli(['scan', 'src/parser']);
    assert.equal(exitCode, 1, `stray positional must exit 1; stderr:\n${stderr}`);
    assert.match(stderr, /unexpected argument\(s\): src\/parser/, `got:\n${stderr}`);
});
