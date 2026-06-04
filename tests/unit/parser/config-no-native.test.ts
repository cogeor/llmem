// tests/unit/parser/config-no-native.test.ts
//
// PH-02: prove that loading `src/parser/config.ts` does NOT load the
// tree-sitter native core addon.
//
// config.ts imports the four tree-sitter adapter classes at module-eval time
// (config.ts:8-11) to derive ALL_SUPPORTED_EXTENSIONS from their `.extensions`
// arrays. Those adapters must only `require('tree-sitter')` lazily — inside an
// extractor constructor — so merely importing config.ts (and therefore the
// adapters) must never touch the native binding.
//
// We assert this by stubbing the module loader so any `require('tree-sitter')`
// throws, then importing config.ts through a fresh module cache. If config-load
// (or any adapter constructed during it) eagerly loaded the core, the import
// would throw and this test would fail.

import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import * as path from 'node:path';

test('importing parser/config.ts does not load the tree-sitter native core', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = Module as any;
    const originalLoad = mod._load;

    let coreLoadAttempts = 0;
    mod._load = function patchedLoad(request: string, ...rest: unknown[]) {
        if (request === 'tree-sitter') {
            coreLoadAttempts++;
            throw new Error(
                'STUB: tree-sitter native core must not be loaded during config import'
            );
        }
        return originalLoad.call(this, request, ...rest);
    };

    const configPath = path.resolve(__dirname, '../../../src/parser/config.ts');

    try {
        // Bust the require cache so the module (and its adapter imports)
        // re-evaluate under the stubbed loader.
        delete require.cache[require.resolve(configPath)];

        assert.doesNotThrow(() => {
            const config = require(configPath);
            // Touch the derived export to force module evaluation to complete.
            assert.ok(
                Array.isArray(config.ALL_SUPPORTED_EXTENSIONS),
                'config must export ALL_SUPPORTED_EXTENSIONS'
            );
            assert.ok(
                config.ALL_SUPPORTED_EXTENSIONS.includes('.py'),
                'config must still advertise tree-sitter extensions (.py)'
            );
        }, 'importing config.ts must not throw, i.e. must not load the native core');

        assert.equal(
            coreLoadAttempts,
            0,
            'config.ts (and its adapter imports) must NOT require("tree-sitter") at load time'
        );
    } finally {
        mod._load = originalLoad;
    }
});
