// tests/unit/parser/python-class-new.test.ts
//
// Loop PC-06 — kind:'new' class-instantiation detection.
//
// A call whose callee is a bare identifier naming a SAME-FILE class is tagged
// kind:'new' (instead of 'function'). Edges are unchanged — this is precision
// polish so downstream consumers can distinguish instantiations.
//
// Two layers of coverage:
//   1. Grammar-FREE unit test of the pure decision helper
//      (PythonExtractor.isSameFileClassInstantiation) — real local coverage
//      that runs even without tree-sitter-python.
//   2. PARSE-based tests of the full extractCalls path, skip-guarded behind the
//      same probe as tests/integration/python-imports.test.ts (these skip here
//      when the optional grammar is absent — correct).

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { PythonExtractor } from '../../../src/parser/python';

// ---------------------------------------------------------------------------
// Layer 1: grammar-FREE unit test of the pure decision helper.
// ---------------------------------------------------------------------------

describe('PC-06 isSameFileClassInstantiation (pure helper)', () => {
    test('returns true when calleeName is a same-file class name', () => {
        const classNames = new Set<string>(['Thing', 'Widget']);
        assert.equal(PythonExtractor.isSameFileClassInstantiation('Thing', classNames), true);
        assert.equal(PythonExtractor.isSameFileClassInstantiation('Widget', classNames), true);
    });

    test('returns false for a non-class callee (plain function)', () => {
        const classNames = new Set<string>(['Thing']);
        assert.equal(PythonExtractor.isSameFileClassInstantiation('helper', classNames), false);
    });

    test('returns false when the class-name set is absent', () => {
        assert.equal(PythonExtractor.isSameFileClassInstantiation('Thing', undefined), false);
    });

    test('returns false against an empty set', () => {
        assert.equal(PythonExtractor.isSameFileClassInstantiation('Thing', new Set<string>()), false);
    });
});

// ---------------------------------------------------------------------------
// Layer 2: PARSE-based, skip-guarded (mirror python-imports.test.ts probe).
// ---------------------------------------------------------------------------

function probePythonExtractor(): string | undefined {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('tree-sitter-python');
        return undefined;
    } catch {
        return 'tree-sitter-python not installed (optional peer dependency)';
    }
}

const SKIP_REASON = probePythonExtractor();

describe('PC-06 class-instantiation detection (parse-based)', { skip: SKIP_REASON }, () => {
    test('same-file class call -> kind "new"; plain function call -> kind "function"', async () => {
        const source = [
            'class Thing:',
            '    pass',
            '',
            'def helper():',
            '    pass',
            '',
            'def f():',
            '    Thing()',
            '    helper()',
            '',
        ].join('\n');

        const extractor = new PythonExtractor(process.cwd());
        const artifact = await extractor.extract('module.py', source);
        assert.ok(artifact, 'extractor returned an artifact');

        const f = artifact!.entities.find((e) => e.name === 'f');
        assert.ok(f, 'entity f present');

        const thingCall = f!.calls!.find((c) => c.calleeName === 'Thing');
        assert.ok(thingCall, 'call to Thing present');
        assert.equal(thingCall!.kind, 'new', 'same-file class instantiation tagged kind:new');

        const helperCall = f!.calls!.find((c) => c.calleeName === 'helper');
        assert.ok(helperCall, 'call to helper present');
        assert.equal(helperCall!.kind, 'function', 'plain function call stays kind:function');
    });

    test('attribute (method) call stays kind "method" even if final name matches a class', async () => {
        // `obj.Thing()` is a method/attribute access, not a same-file
        // instantiation — the 'new' tagging only applies to bare identifiers.
        const source = [
            'class Thing:',
            '    pass',
            '',
            'def f(obj):',
            '    obj.Thing()',
            '',
        ].join('\n');

        const extractor = new PythonExtractor(process.cwd());
        const artifact = await extractor.extract('module.py', source);
        assert.ok(artifact);

        const f = artifact!.entities.find((e) => e.name === 'f');
        const call = f!.calls!.find((c) => c.calleeName === 'Thing');
        assert.ok(call, 'attribute call captured');
        assert.equal(call!.kind, 'method', 'attribute call stays method, not new');
    });
});
