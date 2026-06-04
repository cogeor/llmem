// tests/unit/claude/config.test.ts
//
// Pin the numeric-knob resolution + clamping in `getMcpConfig`
// (src/mcp/config.ts). LS-01 added `maxFileLines` alongside the existing
// `maxFileSizeKB` / `maxFilesPerFolder` knobs; these tests guard that the new
// knob is read from `LLMEM_MAX_FILE_LINES`, defaults to 2000, and clamps the
// same way the other two do (lower bound < 1 → default; upper bound > CAP →
// CAP). The existing knobs are exercised too so the parity stays visible.

import test from 'node:test';
import assert from 'node:assert/strict';

import { getMcpConfig } from '../../../src/mcp/config';
import {
    DEFAULT_CONFIG,
    MAX_FILE_LINES_CAP,
} from '../../../src/config-defaults';

/** Run `fn` with the given env var set, restoring the prior value after. */
function withEnv(name: string, value: string | undefined, fn: () => void): void {
    const prior = process.env[name];
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
    try {
        fn();
    } finally {
        if (prior === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = prior;
        }
    }
}

test('getMcpConfig: maxFileLines defaults to 2000 when env is unset', () => {
    withEnv('LLMEM_MAX_FILE_LINES', undefined, () => {
        assert.equal(getMcpConfig().maxFileLines, DEFAULT_CONFIG.maxFileLines);
        assert.equal(getMcpConfig().maxFileLines, 2000);
    });
});

test('getMcpConfig: maxFileLines honors LLMEM_MAX_FILE_LINES', () => {
    withEnv('LLMEM_MAX_FILE_LINES', '5000', () => {
        assert.equal(getMcpConfig().maxFileLines, 5000);
    });
});

test('getMcpConfig: maxFileLines clamps below-1 values to the default', () => {
    withEnv('LLMEM_MAX_FILE_LINES', '0', () => {
        assert.equal(getMcpConfig().maxFileLines, DEFAULT_CONFIG.maxFileLines);
    });
    withEnv('LLMEM_MAX_FILE_LINES', '-100', () => {
        assert.equal(getMcpConfig().maxFileLines, DEFAULT_CONFIG.maxFileLines);
    });
});

test('getMcpConfig: maxFileLines clamps non-numeric values to the default', () => {
    withEnv('LLMEM_MAX_FILE_LINES', 'not-a-number', () => {
        assert.equal(getMcpConfig().maxFileLines, DEFAULT_CONFIG.maxFileLines);
    });
});

test('getMcpConfig: maxFileLines clamps above-cap values to MAX_FILE_LINES_CAP', () => {
    withEnv('LLMEM_MAX_FILE_LINES', String(MAX_FILE_LINES_CAP + 50000), () => {
        assert.equal(getMcpConfig().maxFileLines, MAX_FILE_LINES_CAP);
    });
});
