// tests/unit/parser/ts-extractor-reference-vs-call.test.ts
//
// C1 regression test — reference-vs-call discrimination in the TypeScript
// call extractor (`findCalls` in `src/parser/ts-extractor/extract-from-source.ts`).
//
// CONTRACT (C1): the call extractor MUST distinguish *invoking* a function
// from *passing / storing / returning* it. A bare function reference used as
// an argument, an RHS, or a return value is NOT a CallExpression/NewExpression
// callee, so `findCalls` MUST NOT emit a CallSite for it. Only the callee
// position of a real call/new is recorded.
//
// This pins already-correct behavior so a future refactor of `findCalls`
// cannot silently reintroduce phantom reference-as-call edges (the alleged
// `parts <-> regenerateWebview` cycle). NO source change accompanies this test.
//
// Harness mirrors `extractor-content-contract.test.ts`: get the TS adapter via
// the registry, `createExtractor(tempDir)`, then `extract(virtualPath, content)`
// against an in-memory source string (virtual path — no disk write needed).
// Guarded with `if (tsAdapter)` like the sibling file.
//
// On failure: re-read `findCalls` in
// `src/parser/ts-extractor/extract-from-source.ts` — a reference (arg / stored /
// returned) leaked into `entity.calls`, breaking the C1 contract.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { ParserRegistry } from '../../../src/parser/registry';

// One in-memory fixture, one case per exported entity so `findCalls` runs
// per-entity. (Exact source from PLAN Loop 01, Task 1, step 2.)
const FIXTURE = [
    'export function setHandler(cb: () => void) { return cb; }',
    'export function foo() { return 1; }',
    'export function passesRef() { return setHandler(foo); }     // foo = arg ref',
    'export function storesRef() { const h = foo; return h; }    // foo = stored ref',
    'export function returnsRef() { return foo; }                // foo = returned ref',
    'export function invokes() { return foo(); }                 // foo = real call',
    'export function methodCall(o: any) { return o.foo(); }      // real method call',
].join('\n') + '\n';

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-ref-vs-call-'));
}

function rmTempDir(dir: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch {
        // best-effort cleanup
    }
}

const tsAdapter = ParserRegistry.getInstance().getAdapter('typescript');

if (tsAdapter) {
    test('C1: function references (arg/stored/returned) are not call edges; invocations are', async () => {
        const tempDir = makeTempDir();
        try {
            const virtualPath = path.join(tempDir, 'ref-vs-call.ts');
            assert.ok(
                !fs.existsSync(virtualPath),
                'precondition: fixture must be in-memory only (not on disk)'
            );

            const extractor = tsAdapter.createExtractor(tempDir);
            const artifact = await extractor.extract(virtualPath, FIXTURE);

            assert.ok(
                artifact,
                'extract must return a non-null artifact when content is supplied'
            );

            // For an entity, the C1-relevant projection is the list of callee
            // names `findCalls` emitted into `entity.calls`.
            const byName = (n: string): string[] => {
                const entity = artifact!.entities.find(e => e.name === n);
                assert.ok(
                    entity,
                    `C1 fixture entity '${n}' not extracted — cannot check findCalls output`
                );
                return (entity!.calls ?? []).map(c => c.calleeName);
            };

            // 1. reference passed as ARGUMENT is NOT a call. Only the outer
            //    invocation `setHandler(...)` is recorded; `foo` must not be.
            assert.equal(
                byName('passesRef').includes('foo'),
                false,
                'C1 (findCalls): `foo` passed as an argument is a reference, not a call — must not be a call edge'
            );
            assert.deepEqual(
                byName('passesRef'),
                ['setHandler'],
                'C1 (findCalls): only the real invocation `setHandler(...)` is a call edge; the `foo` argument reference is not'
            );

            // 2. stored reference (`const h = foo`) is NOT a call.
            assert.deepEqual(
                byName('storesRef'),
                [],
                'C1 (findCalls): assigning `const h = foo` stores a reference — it must produce no call edge'
            );

            // 3. returned reference (`return foo`) is NOT a call.
            assert.deepEqual(
                byName('returnsRef'),
                [],
                'C1 (findCalls): `return foo` returns a reference — it must produce no call edge'
            );

            // 4. direct invocation (`foo()`) IS one call.
            assert.deepEqual(
                byName('invokes'),
                ['foo'],
                'C1 (findCalls): `foo()` is a real invocation — it must produce exactly one call edge'
            );

            // 5. method invocation (`o.foo()`) IS one call.
            assert.deepEqual(
                byName('methodCall'),
                ['foo'],
                'C1 (findCalls): `o.foo()` is a real method invocation — it must produce exactly one call edge'
            );
        } finally {
            rmTempDir(tempDir);
        }
    });
}
