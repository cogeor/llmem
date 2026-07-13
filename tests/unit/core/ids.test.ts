// tests/unit/core/ids.test.ts
//
// isExternalModuleId / parseGraphId classification contract.
//
// Regression (2026-07-13 review, bug 1.1): files at the repo ROOT (`a.ts`,
// `main.py`) have no '/' in their id and were classified as EXTERNAL modules,
// so all their import edges were silently dropped in internal-only scans —
// a fresh repo with a genuine a.ts <-> b.ts cycle scanned to 0 import edges.
// The fix: a slashless id that carries a supported source-file extension is a
// workspace FILE, not an external module.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { isExternalModuleId, parseGraphId } from '../../../src/core/ids';

describe('isExternalModuleId', () => {
    test('root-level source files are INTERNAL (the 1.1 regression)', () => {
        assert.equal(isExternalModuleId('b.ts'), false);
        assert.equal(isExternalModuleId('a.tsx'), false);
        assert.equal(isExternalModuleId('index.js'), false);
        assert.equal(isExternalModuleId('main.py'), false);
        assert.equal(isExternalModuleId('os.py'), false); // extension wins over name
        assert.equal(isExternalModuleId('lib.rs'), false);
        assert.equal(isExternalModuleId('util.cpp'), false);
    });

    test('extension match is case-insensitive (.R)', () => {
        assert.equal(isExternalModuleId('analysis.R'), false);
        assert.equal(isExternalModuleId('analysis.r'), false);
    });

    test('bare external module specifiers stay EXTERNAL', () => {
        assert.equal(isExternalModuleId('react'), true);
        assert.equal(isExternalModuleId('pathlib'), true);
        assert.equal(isExternalModuleId('os'), true);
        assert.equal(isExternalModuleId('node:path'), true);
    });

    test('dotted specifiers without a SOURCE extension stay EXTERNAL', () => {
        // A dot alone does not make a file — only a supported extension does.
        assert.equal(isExternalModuleId('lodash.merge'), true);
        assert.equal(isExternalModuleId('config.json'), true);
    });

    test('scoped packages contain a slash and were never external-by-this-check', () => {
        // '@scope/pkg' has a '/', so this function calls it internal; the
        // node_modules filter downstream is what excludes real packages.
        // Pinned so the fix does not change this pre-existing behavior.
        assert.equal(isExternalModuleId('@scope/pkg'), false);
    });

    test('entity ids are never external', () => {
        assert.equal(isExternalModuleId('file.ts::fn'), false);
        assert.equal(isExternalModuleId('b.ts::fn'), false);
    });

    test('paths with slashes are internal', () => {
        assert.equal(isExternalModuleId('src/feature/a.ts'), false);
    });
});

describe('parseGraphId', () => {
    test('root-level source file parses as kind:file (not external)', () => {
        assert.deepEqual(parseGraphId('b.ts'), { kind: 'file', fileId: 'b.ts' });
    });

    test('bare specifier parses as kind:external', () => {
        assert.deepEqual(parseGraphId('react'), { kind: 'external', module: 'react' });
    });

    test('entity id splits on first ::', () => {
        assert.deepEqual(parseGraphId('a.ts::fn'), {
            kind: 'entity',
            fileId: 'a.ts',
            name: 'fn',
        });
    });
});
