// tests/unit/runtime/config-internal-only.test.ts
//
// Loop 03 — pin the `internalOnly` knob in the runtime config loader
// (src/runtime/config.ts) and its default in DEFAULT_CONFIG.
//
// Semantics: internal-only is the DEFAULT (true). `LLMEM_INTERNAL_ONLY=0` or
// `=false` (case-insensitive) DISABLES internal-only (includes externals); any
// other value (or unset) leaves it true. Booleans are not numeric, so unlike
// the maxFile* knobs this is parsed by parseInternalOnly, not parseInt.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig, resetConfig } from '../../../src/runtime/config';
import { DEFAULT_CONFIG } from '../../../src/config-defaults';

/** Run `fn` with LLMEM_INTERNAL_ONLY set/unset, restoring after; resets cache. */
function withEnv(value: string | undefined, fn: () => void): void {
    const name = 'LLMEM_INTERNAL_ONLY';
    const prior = process.env[name];
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
    resetConfig();
    try {
        fn();
    } finally {
        if (prior === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = prior;
        }
        resetConfig();
    }
}

test('DEFAULT_CONFIG.internalOnly is true (internal-only is the default)', () => {
    assert.equal(DEFAULT_CONFIG.internalOnly, true);
});

test('loadConfig: internalOnly defaults to true when LLMEM_INTERNAL_ONLY is unset', () => {
    withEnv(undefined, () => {
        assert.equal(loadConfig().internalOnly, true);
    });
});

test('loadConfig: LLMEM_INTERNAL_ONLY=0 disables internal-only (includes externals)', () => {
    withEnv('0', () => {
        assert.equal(loadConfig().internalOnly, false);
    });
});

test('loadConfig: LLMEM_INTERNAL_ONLY=false (case-insensitive) disables internal-only', () => {
    withEnv('false', () => {
        assert.equal(loadConfig().internalOnly, false);
    });
    withEnv('FALSE', () => {
        assert.equal(loadConfig().internalOnly, false);
    });
});

test('loadConfig: LLMEM_INTERNAL_ONLY=1 / true keeps internal-only on', () => {
    withEnv('1', () => {
        assert.equal(loadConfig().internalOnly, true);
    });
    withEnv('true', () => {
        assert.equal(loadConfig().internalOnly, true);
    });
});
