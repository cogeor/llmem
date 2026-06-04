// tests/contracts/script-artifact-root.test.ts
//
// A-grade #3 — dev scripts must not hardcode a storage root.
//
// `src/scripts/**` are developer entrypoints that build a WorkspaceContext.
// They must derive the artifact root from the product default
// (`DEFAULT_CONFIG.artifactRoot`) or the resolved runtime `config.artifactRoot`,
// never a string literal such as the legacy `.artifacts`. A literal override
// drifts dev runs away from `bin/llmem scan` — that drift was the regrade's
// remaining issue #3.
//
// This test fails if any file under src/scripts/ passes a STRING-LITERAL
// `artifactRoot:` override. Property references like `config.artifactRoot`
// or `DEFAULT_CONFIG.artifactRoot` (no quote after the colon) stay allowed,
// because they carry the resolved/default value rather than a hardcode.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_CONFIG } from '../../src/config-defaults';

const SCRIPTS_DIR = path.resolve(__dirname, '..', '..', 'src', 'scripts');

// `artifactRoot:` followed by a string literal (single/double/backtick quote).
// A property reference (`config.artifactRoot`, `DEFAULT_CONFIG.artifactRoot`)
// has no opening quote after the colon, so it does not match.
const LITERAL_ARTIFACT_ROOT_RE = /artifactRoot:\s*['"`]/;

function listScriptFiles(): string[] {
    return fs
        .readdirSync(SCRIPTS_DIR)
        .filter((n) => n.endsWith('.ts'))
        .map((n) => path.join(SCRIPTS_DIR, n))
        .sort();
}

test('script-artifact-root: product default is `.llmem/graph` (the value scripts inherit)', () => {
    // Pins the inherited default so a silent change to the product storage
    // root surfaces here alongside the scripts that rely on it.
    assert.equal(DEFAULT_CONFIG.artifactRoot, '.llmem/graph');
});

test('script-artifact-root: no dev script hardcodes a string-literal artifactRoot override', () => {
    const offenders: string[] = [];
    for (const file of listScriptFiles()) {
        const lines = fs.readFileSync(file, 'utf-8').split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (LITERAL_ARTIFACT_ROOT_RE.test(lines[i])) {
                offenders.push(`${path.basename(file)}:${i + 1}  ${lines[i].trim()}`);
            }
        }
    }
    assert.deepEqual(
        offenders,
        [],
        `Dev scripts must derive the artifact root from config / DEFAULT_CONFIG, ` +
            `not a string literal (this is how the legacy '.artifacts' drift came ` +
            `back). Offending lines:\n  ${offenders.join('\n  ')}`,
    );
});
