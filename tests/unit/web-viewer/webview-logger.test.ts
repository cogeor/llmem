// tests/unit/web-viewer/webview-logger.test.ts
//
// Loop 14 — pin the gating contract of `createWebviewLogger`.
//
// Asymmetric levels:
//   - `error` and `warn`  → ALWAYS emit, regardless of `enabled`.
//   - `log` and `debug`   → no-op when `enabled === false`.
//
// The browser logger is the SOLE sanctioned `console.*` site under
// `src/webview/ui/**` (enforced by tests/arch/console-discipline.test.ts).
// This test stubs `console.{error,warn,log,debug}` to capture forwarded
// calls and verifies the gating decision matches the contract.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createWebviewLogger } from '../../../src/webview/ui/services/webview-logger';

interface ConsoleStub {
    readonly error: unknown[][];
    readonly warn: unknown[][];
    readonly log: unknown[][];
    readonly debug: unknown[][];
}

function withStubbedConsole<T>(fn: (calls: ConsoleStub) => T): T {
    const calls: ConsoleStub = { error: [], warn: [], log: [], debug: [] };
    const original = {
        error: console.error,
        warn: console.warn,
        log: console.log,
        debug: console.debug,
    };
    console.error = (...args: unknown[]): void => {
        calls.error.push(args);
    };
    console.warn = (...args: unknown[]): void => {
        calls.warn.push(args);
    };
    console.log = (...args: unknown[]): void => {
        calls.log.push(args);
    };
    console.debug = (...args: unknown[]): void => {
        calls.debug.push(args);
    };
    try {
        return fn(calls);
    } finally {
        console.error = original.error;
        console.warn = original.warn;
        console.log = original.log;
        console.debug = original.debug;
    }
}

test('webview-logger: enabled=false silences log/debug but always emits warn/error', () => {
    withStubbedConsole((calls) => {
        const logger = createWebviewLogger({ enabled: false });
        logger.log('one');
        logger.debug('two');
        logger.warn('three');
        logger.error('four', { extra: 'object' });

        assert.equal(calls.log.length, 0, 'log() must be silenced when enabled=false');
        assert.equal(calls.debug.length, 0, 'debug() must be silenced when enabled=false');
        assert.equal(calls.warn.length, 1, 'warn() must always emit');
        assert.deepEqual(calls.warn[0], ['three']);
        assert.equal(calls.error.length, 1, 'error() must always emit');
        assert.deepEqual(calls.error[0], ['four', { extra: 'object' }]);
    });
});

test('webview-logger: enabled=true forwards log/debug too', () => {
    withStubbedConsole((calls) => {
        const logger = createWebviewLogger({ enabled: true });
        logger.log('one', 'two');
        logger.debug('three');
        logger.warn('four');
        logger.error('five');

        assert.equal(calls.log.length, 1);
        assert.deepEqual(calls.log[0], ['one', 'two']);
        assert.equal(calls.debug.length, 1);
        assert.deepEqual(calls.debug[0], ['three']);
        assert.equal(calls.warn.length, 1);
        assert.deepEqual(calls.warn[0], ['four']);
        assert.equal(calls.error.length, 1);
        assert.deepEqual(calls.error[0], ['five']);
    });
});

test('webview-logger: enabled is read once at construction (flipping later is a no-op)', () => {
    withStubbedConsole((calls) => {
        // Construct with enabled=false, then flip the source. The contract
        // documented in webview-logger.ts is: the flag is read once at
        // construction; flipping window.LLMEM_DEBUG after the fact does
        // not retroactively re-gate live loggers.
        const opts = { enabled: false };
        const logger = createWebviewLogger(opts);
        opts.enabled = true; // mutate AFTER construction
        logger.log('still silent');

        assert.equal(calls.log.length, 0,
            'flipping the source object after construction must not re-gate the logger');
    });
});
