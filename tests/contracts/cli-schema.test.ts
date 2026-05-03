/**
 * CLI schema contract test (Loop 04).
 *
 * Pins the wire shape of `bin/llmem describe --json` to a checked-in
 * snapshot file. Any change to `examples`, `args`, the `CommandSpec`
 * shape, or REGISTRY membership trips this test, forcing the contributor
 * to deliberately update the snapshot rather than silently changing the
 * agent-integration surface.
 *
 * Snapshot regeneration recipe (Linux/macOS bash):
 *
 *   npm run build:claude
 *   node ./bin/llmem describe --json \
 *     | sed 's/"version": "[^"]*"/"version": "<X>"/' \
 *     > tests/contracts/__snapshots__/cli-describe.json
 *
 * On Windows (PowerShell):
 *
 *   npm run build:claude
 *   node ./bin/llmem describe --json `
 *     | ForEach-Object { $_ -replace '"version": "[^"]*"', '"version": "<X>"' } `
 *     | Out-File -Encoding utf8 -NoNewline tests/contracts/__snapshots__/cli-describe.json
 *
 * Cross-platform notes:
 * - Stdout is normalized via `replace(/\r\n/g, '\n')` before compare so
 *   the snapshot file's bytes are identical on Windows / macOS / Linux.
 * - The `version` field is read from `package.json#version` and is
 *   stripped at compare time so a version bump does not require a
 *   snapshot rewrite. The snapshot file checks in `"version": "<X>"`
 *   literally and the same substitution is applied to spawned output.
 * - `describe` output is pure schema (no workspace paths). If a future
 *   command surfaces a path in its `args.description` or example
 *   `command` and it leaks into the snapshot, that loop must add
 *   forward-slash normalization at the JSON boundary.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

const REPO_ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'llmem');
const DIST_MAIN = path.join(REPO_ROOT, 'dist', 'claude', 'cli', 'main.js');
const SNAPSHOT_PATH = path.join(__dirname, '__snapshots__', 'cli-describe.json');

function ensureBuilt(): void {
    if (!fs.existsSync(DIST_MAIN)) {
        throw new Error(
            `Expected ${DIST_MAIN} to exist. Run \`npm run build:claude\` before \`npm test\`.`,
        );
    }
}

function stripVersion(s: string): string {
    return s.replace(/"version": "[^"]+"/, '"version": "<X>"');
}

test('bin/llmem describe --json matches the checked-in snapshot (version stripped)', () => {
    ensureBuilt();
    const result = spawnSync('node', [BIN, 'describe', '--json'], {
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '0' },
    });
    assert.equal(result.status, 0, `describe --json exit code; stderr=${result.stderr}`);

    // Normalize CRLF → LF, single trailing \n.
    const actual = result.stdout.replace(/\r\n/g, '\n').replace(/\n+$/, '') + '\n';
    const expected = fs.readFileSync(SNAPSHOT_PATH, 'utf8');

    assert.equal(
        stripVersion(actual),
        stripVersion(expected),
        'describe --json output drifted from snapshot. ' +
            'If intentional, regenerate snapshot per the docblock recipe.',
    );
});
