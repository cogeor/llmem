// tests/unit/parser/type-only-import.test.ts
//
// Loop 03 (health-analysis) — pin `ImportSpec.typeOnly` detection in the TS
// extractor. `import type` edges are erased at compile time, so a cycle through
// only such edges is NOT a runtime import cycle; the analyzer relies on this
// flag being set correctly at the source.
//
// Detection rules under test (mirror extract-from-source.ts):
//   - whole-clause `import type { X }` / `import type X`        => true
//   - named clause, EVERY specifier `type`-qualified           => true
//   - MIXED `import { type A, B }` (has a runtime binding `B`)  => false
//   - plain `import { A }`                                      => false
//   - default `import X`                                        => false
//   - namespace `import * as N` (runtime binding)              => false
//
// Each import points at a sibling file written into the same tmp dir so the
// ImportSpec survives module resolution and can be inspected.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ParserRegistry } from '../../../src/parser/registry';
import type { ImportSpec } from '../../../src/parser/types';

/**
 * Write `main.ts` (containing `mainSource`) plus a sibling `m.ts` export module
 * into a fresh tmp dir, extract `main.ts`, and return its imports.
 */
async function importsOf(mainSource: string): Promise<ImportSpec[]> {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-typeonly-'));
    try {
        fs.writeFileSync(path.join(tmp, 'package.json'), '{}', 'utf8');
        fs.writeFileSync(
            path.join(tmp, 'm.ts'),
            'export type A = number;\n' +
                'export type B = string;\n' +
                'export type X = boolean;\n' +
                'export const A2 = 1;\n' +
                'export const B2 = 2;\n' +
                'export default 0;\n',
            'utf8',
        );
        fs.writeFileSync(path.join(tmp, 'main.ts'), mainSource, 'utf8');

        const adapter = ParserRegistry.getInstance().getAdapter('typescript')!;
        assert.ok(adapter, 'typescript adapter must be registered');
        const extractor = adapter.createExtractor(tmp);
        const artifact = await extractor.extract(path.join(tmp, 'main.ts'));
        assert.ok(artifact, 'extract returned null');
        return artifact!.imports;
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

function only(imports: ImportSpec[]): ImportSpec {
    const fromM = imports.filter(i => i.source === './m');
    assert.equal(fromM.length, 1, `expected exactly one './m' import, got ${fromM.length}`);
    return fromM[0];
}

test('type-only: whole-clause `import type { X }` => typeOnly true', async () => {
    const imp = only(await importsOf(`import type { X } from './m';\nconsole.log('' as unknown as X);\n`));
    assert.equal(imp.typeOnly, true);
});

test('type-only: every-specifier `import { type A, type B }` => typeOnly true', async () => {
    const imp = only(await importsOf(`import { type A, type B } from './m';\nlet a: A; let b: B; void a; void b;\n`));
    assert.equal(imp.typeOnly, true);
});

test('type-only: MIXED `import { type A, B2 }` => typeOnly false (has runtime binding)', async () => {
    const imp = only(await importsOf(`import { type A, B2 } from './m';\nlet a: A; void a; console.log(B2);\n`));
    assert.equal(imp.typeOnly, false);
});

test('type-only: plain `import { A2 }` => typeOnly false', async () => {
    const imp = only(await importsOf(`import { A2 } from './m';\nconsole.log(A2);\n`));
    assert.equal(imp.typeOnly, false);
});

test('type-only: default `import X` => typeOnly false', async () => {
    const imp = only(await importsOf(`import X from './m';\nconsole.log(X);\n`));
    assert.equal(imp.typeOnly, false);
});

test('type-only: namespace `import * as N` => typeOnly false', async () => {
    const imp = only(await importsOf(`import * as N from './m';\nconsole.log(N.A2);\n`));
    assert.equal(imp.typeOnly, false);
});
