/**
 * Smoke test for the bin/llmem shim → src/claude/cli/main.ts dispatcher.
 *
 * Loop 01 originally pinned "lists the four commands" against the old
 * hardcoded help. Loop 07 made `printHelp` registry-driven and hid
 * `generate`/`stats`, so the assertion now is:
 *   1. `--help` exits 0 and lists the six visible commands.
 *   2. `--help` does NOT mention the hidden commands (`generate`, `stats`).
 *   3. No-args prints help and exits 1 (preserves today's behavior).
 *
 * Cross-platform note: spawning `node` explicitly with the JS path bypasses
 * npm's `.cmd` wrapper on Windows and tests the actual JS shim.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

const BIN = path.join(__dirname, '..', '..', '..', 'bin', 'llmem');
const DIST_MAIN = path.join(__dirname, '..', '..', '..', 'dist', 'claude', 'cli', 'main.js');

function ensureBuilt(): void {
    if (!fs.existsSync(DIST_MAIN)) {
        // The shim require()s dist/claude/cli/main.js. If the integration
        // test runs without `npm run build:claude` first, surface a clear
        // failure rather than the cryptic "Cannot find module" from require().
        throw new Error(
            `Expected ${DIST_MAIN} to exist. Run \`npm run build:claude\` before \`npm run test:integration\`.`,
        );
    }
}

test('bin/llmem --help exits 0 and lists every visible command, no hidden ones', () => {
    ensureBuilt();
    const result = spawnSync('node', [BIN, '--help'], { encoding: 'utf8' });
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}; stderr=${result.stderr}`);
    const out = result.stdout;
    // The six visible commands as of loop 07 (REGISTRY filter `!hidden`).
    for (const cmd of ['serve', 'mcp', 'describe', 'scan', 'document', 'init']) {
        assert.match(out, new RegExp(`\\b${cmd}\\b`), `help text mentions '${cmd}'`);
    }
    // Hidden command names must NOT appear as word tokens. Word-boundary
    // regex avoids false positives from English usage like "Generate" in
    // `document`'s description (see cli-describe.test.ts for the longer
    // commentary on this).
    for (const cmd of ['generate', 'stats']) {
        assert.ok(
            !new RegExp(`\\b${cmd}\\b`).test(out),
            `help must NOT mention hidden command '${cmd}'`,
        );
    }
});

test('bin/llmem with no args prints help and exits 1', () => {
    ensureBuilt();
    const result = spawnSync('node', [BIN], { encoding: 'utf8' });
    assert.equal(result.status, 1, `expected exit 1, got ${result.status}; stderr=${result.stderr}`);
    assert.match(result.stdout, /Usage:/i);
});
