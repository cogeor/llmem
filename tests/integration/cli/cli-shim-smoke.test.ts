/**
 * Smoke test for the bin/llmem shim → src/claude/cli/main.ts dispatcher.
 *
 * Loop 01 contract: NO behavior change. We only assert the most basic
 * surface area:
 *   1. `--help` exits 0 and lists the four commands.
 *   2. No-args prints help and exits 1 (preserves today's behavior).
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

test('bin/llmem --help exits 0 and lists the four commands', () => {
    ensureBuilt();
    const result = spawnSync('node', [BIN, '--help'], { encoding: 'utf8' });
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}; stderr=${result.stderr}`);
    const out = result.stdout;
    for (const cmd of ['serve', 'mcp', 'generate', 'stats']) {
        assert.match(out, new RegExp(`\\b${cmd}\\b`), `help text mentions '${cmd}'`);
    }
});

test('bin/llmem with no args prints help and exits 1', () => {
    ensureBuilt();
    const result = spawnSync('node', [BIN], { encoding: 'utf8' });
    assert.equal(result.status, 1, `expected exit 1, got ${result.status}; stderr=${result.stderr}`);
    assert.match(result.stdout, /Usage:/i);
});
