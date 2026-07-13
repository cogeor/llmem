// tests/unit/cli/arg-parser.test.ts
//
// B1 (2026-07-13) — parseArgv contract for the version/help short-circuits
// and the flag rules the dispatcher depends on. Pure unit test, no spawn.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseArgv } from '../../../src/cli/arg-parser';

describe('parseArgv — version/help short-circuits', () => {
    test('--version sets versionRequested', () => {
        const p = parseArgv(['--version']);
        assert.equal(p.versionRequested, true);
        assert.equal(p.helpRequested, false);
        assert.equal(p.command, null);
    });

    test('-V (uppercase) sets versionRequested; -v stays verbose', () => {
        assert.equal(parseArgv(['-V']).versionRequested, true);
        const verbose = parseArgv(['-v']);
        assert.equal(verbose.versionRequested, false);
        assert.equal(verbose.flagMap.verbose, true);
    });

    test('--help / -h set helpRequested, not versionRequested', () => {
        assert.equal(parseArgv(['--help']).helpRequested, true);
        assert.equal(parseArgv(['-h']).helpRequested, true);
        assert.equal(parseArgv(['--help']).versionRequested, false);
    });

    test('version flag alongside a command still short-circuits', () => {
        const p = parseArgv(['health', '--version']);
        assert.equal(p.versionRequested, true);
        assert.equal(p.command?.name, 'health');
    });
});

describe('parseArgv — command + flag routing', () => {
    test('unknown first positional lands in flagMap._ with command null', () => {
        const p = parseArgv(['fnord']);
        assert.equal(p.command, null);
        assert.deepEqual(p.flagMap._, ['fnord']);
    });

    test('known command consumes the first positional only', () => {
        const p = parseArgv(['review', 'src/webview']);
        assert.equal(p.command?.name, 'review');
        assert.deepEqual(p.flagMap._, ['src/webview']);
    });

    test('--no-foo sets false; --foo=bar sets value; kebab-case camelizes', () => {
        const p = parseArgv(['serve', '--no-open', '--port=8080', '--fail-on', 'clone']);
        assert.equal(p.flagMap.open, false);
        assert.equal(p.flagMap.port, '8080');
        assert.equal(p.flagMap.failOn, 'clone');
    });
});
