/**
 * Python call-extraction integration test (Loop PC-01).
 *
 * Exercises PythonExtractor.extractCalls via the full extract() pipeline and
 * the language-agnostic call-edge resolver (artifactToEdgeList). It validates:
 *
 *   1. Intra-file tier-3 resolution: `def a(): b()` + `def b()` -> edge a->b.
 *   2. Self-method tier-3: `class C: def m(self): self.n()` + sibling `def n`
 *      -> edge m->n (calleeName is the FINAL identifier 'n').
 *   3. The calleeName rule table (FINAL identifier, never a dotted path):
 *      mod.func -> 'func', obj.method -> 'method', self.parse -> 'parse',
 *      Thing()  -> 'Thing'.
 *   4. Scope boundary: a nested def's calls are NOT attributed to the encloser
 *      (`def outer(): def inner(): x()` puts NO call to x on outer).
 *
 * SKIP GUARD: tree-sitter-python is an optional peer dep and its native build
 * may be absent (the extractor require()s it lazily in its constructor). We
 * probe once (mirroring tests/integration/python-imports.test.ts) and pass the
 * result to every describe block as `{ skip }`. When the grammar IS installed
 * (CI / dev machines with the build) these run for real.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { PythonExtractor } from '../../src/parser/python';
import { artifactToEdgeList } from '../../src/application/artifact-converter';
import { makeEntityId } from '../../src/core/ids';
import type { CallSite } from '../../src/parser/types';

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

function writeTemp(prefix: string, source: string): { root: string; file: string; fileId: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const file = path.join(root, 'mod.py');
    fs.writeFileSync(file, source);
    return { root, file, fileId: 'mod.py' };
}

describe('python calls — intra-file tier-3 (a -> b)', { skip: SKIP_REASON }, () => {
    test('def a(): b() produces a call edge a -> b', async () => {
        const { root, file, fileId } = writeTemp('llmem-py-call-ab-', [
            'def a():',
            '    b()',
            '',
            'def b():',
            '    pass',
            '',
        ].join('\n'));
        try {
            const extractor = new PythonExtractor(root);
            const artifact = await extractor.extract(file);
            assert.ok(artifact);

            const entityA = artifact!.entities.find((e) => e.name === 'a');
            assert.ok(entityA, 'entity a exists');
            const calleeNames = (entityA!.calls ?? []).map((c) => c.calleeName);
            assert.ok(calleeNames.includes('b'), `a should call b, got: ${calleeNames.join(',')}`);

            const { callEdges } = artifactToEdgeList(artifact!, fileId);
            const aId = makeEntityId(fileId, 'a');
            const bId = makeEntityId(fileId, 'b');
            const ab = callEdges.find((e) => e.source === aId && e.target === bId);
            assert.ok(ab, `expected call edge ${aId} -> ${bId}`);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('python calls — self-method tier-3 (m -> n)', { skip: SKIP_REASON }, () => {
    test('self.n() inside method m resolves to sibling def n', async () => {
        const { root, file, fileId } = writeTemp('llmem-py-call-mn-', [
            'class C:',
            '    def m(self):',
            '        self.n()',
            '',
            'def n():',
            '    pass',
            '',
        ].join('\n'));
        try {
            const extractor = new PythonExtractor(root);
            const artifact = await extractor.extract(file);
            assert.ok(artifact);

            const entityM = artifact!.entities.find((e) => e.name === 'm');
            assert.ok(entityM, 'method m exists');
            const calls = entityM!.calls ?? [];
            const selfN = calls.find((c) => c.calleeName === 'n');
            assert.ok(selfN, 'self.n() should yield calleeName "n" (FINAL identifier)');
            assert.equal(selfN!.kind, 'method');

            const { callEdges } = artifactToEdgeList(artifact!, fileId);
            const mId = makeEntityId(fileId, 'm');
            const nId = makeEntityId(fileId, 'n');
            const mn = callEdges.find((e) => e.source === mId && e.target === nId);
            assert.ok(mn, `expected call edge ${mId} -> ${nId}`);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('python calls — calleeName rule table (FINAL identifier)', { skip: SKIP_REASON }, () => {
    test('mod.func, obj.method, self.parse, Thing() all emit the FINAL identifier', async () => {
        const { root, file } = writeTemp('llmem-py-call-rules-', [
            'def driver(self, obj, mod):',
            '    mod.func()',
            '    obj.method()',
            '    self.parse()',
            '    Thing()',
            '',
        ].join('\n'));
        try {
            const extractor = new PythonExtractor(root);
            const artifact = await extractor.extract(file);
            assert.ok(artifact);

            const driver = artifact!.entities.find((e) => e.name === 'driver');
            assert.ok(driver, 'entity driver exists');
            const byName = new Map<string, CallSite>();
            for (const c of driver!.calls ?? []) byName.set(c.calleeName, c);

            assert.ok(byName.has('func'), 'mod.func -> func');
            assert.equal(byName.get('func')!.kind, 'method');
            assert.ok(byName.has('method'), 'obj.method -> method');
            assert.equal(byName.get('method')!.kind, 'method');
            assert.ok(byName.has('parse'), 'self.parse -> parse');
            assert.equal(byName.get('parse')!.kind, 'method');
            assert.ok(byName.has('Thing'), 'Thing() -> Thing');
            assert.equal(byName.get('Thing')!.kind, 'function');

            // No calleeName should be a dotted path.
            for (const c of driver!.calls ?? []) {
                assert.ok(!c.calleeName.includes('.'), `calleeName must be bare, got "${c.calleeName}"`);
            }
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('python calls — scope boundary (nested def isolation)', { skip: SKIP_REASON }, () => {
    test('def outer(): def inner(): x() puts NO call to x on outer', async () => {
        const { root, file } = writeTemp('llmem-py-call-nested-', [
            'def outer():',
            '    def inner():',
            '        x()',
            '    return inner',
            '',
        ].join('\n'));
        try {
            const extractor = new PythonExtractor(root);
            const artifact = await extractor.extract(file);
            assert.ok(artifact);

            const outer = artifact!.entities.find((e) => e.name === 'outer');
            assert.ok(outer, 'entity outer exists');
            const outerCallees = (outer!.calls ?? []).map((c) => c.calleeName);
            assert.ok(!outerCallees.includes('x'), `outer must NOT call x, got: ${outerCallees.join(',')}`);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
