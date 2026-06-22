// tests/unit/parser/tsconfig-registry-monorepo.test.ts
//
// Loop 02 — nearest-enclosing tsconfig resolution.
//
// Regression guard for the monorepo bug: when the workspace root has NO
// tsconfig.json and the `@/*` path alias lives in a SUBDIRECTORY tsconfig
// (e.g. aipr's `frontend/tsconfig.json`), internal `@/...` imports were
// misclassified as external because the resolver was handed pathless
// compiler options anchored at the workspace root.
//
// Fixture (built under os.tmpdir()):
//   <tmp>/                         (NO tsconfig.json here)
//   <tmp>/sub/tsconfig.json        { paths: { "@/*": ["./src/*"] } }
//   <tmp>/sub/src/a.ts             imports '@/b', './b', and 'react'
//   <tmp>/sub/src/b.ts
//
// Assertions:
//   1. TsconfigRegistry.optionsForFile(a.ts) yields paths/baseUrl anchored
//      at <tmp>/sub (pathsBasePath = the tsconfig's own dir).
//   2. Through the extractor: '@/b' resolves to the INTERNAL file
//      'sub/src/b.ts' (resolved, not external).
//   3. The relative './b' also resolves to 'sub/src/b.ts'.
//   4. A bare 'react' import stays external (resolvedPath null).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { ParserRegistry } from '../../../src/parser/registry';
import { TsconfigRegistry } from '../../../src/parser/tsconfig-registry';

function makeMonorepoFixture(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-monorepo-'));
    const subSrc = path.join(root, 'sub', 'src');
    fs.mkdirSync(subSrc, { recursive: true });

    // NOTE: deliberately NO tsconfig.json at `root`.
    fs.writeFileSync(
        path.join(root, 'sub', 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
        'utf-8'
    );
    fs.writeFileSync(
        path.join(subSrc, 'a.ts'),
        [
            "import { b } from '@/b';",
            "import { b as b2 } from './b';",
            "import { useState } from 'react';",
            'export function run() { return b() + b2() + (useState as unknown as number); }',
        ].join('\n') + '\n',
        'utf-8'
    );
    fs.writeFileSync(
        path.join(subSrc, 'b.ts'),
        'export function b() { return 1; }\n',
        'utf-8'
    );
    return root;
}

function rmDir(dir: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch {
        // best-effort
    }
}

test('TsconfigRegistry.optionsForFile picks the nearest sub-tsconfig and anchors pathsBasePath at its dir', () => {
    const root = makeMonorepoFixture();
    try {
        const registry = new TsconfigRegistry(root);
        const aFile = path.join(root, 'sub', 'src', 'a.ts');
        const options = registry.optionsForFile(aFile);

        // The `@/*` alias must be present (it came from sub/tsconfig.json,
        // NOT from a non-existent root tsconfig).
        assert.ok(options.paths, 'paths must be loaded from sub/tsconfig.json');
        assert.deepEqual(options.paths!['@/*'], ['./src/*']);

        // pathsBasePath must anchor at <tmp>/sub (the tsconfig's OWN dir),
        // so `@/* -> ./src/*` resolves to <tmp>/sub/src/*.
        const expectedBase = path.join(root, 'sub');
        assert.equal(
            (options.pathsBasePath as string | undefined)?.replace(/\\/g, '/'),
            expectedBase.replace(/\\/g, '/'),
            'pathsBasePath must be the sub-tsconfig directory'
        );
    } finally {
        rmDir(root);
    }
});

test('TsconfigRegistry.optionsForFile falls back to defaults when no ancestor tsconfig exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-no-tsconfig-'));
    try {
        const registry = new TsconfigRegistry(root);
        const options = registry.optionsForFile(path.join(root, 'x.ts'));
        // No paths/baseUrl when there is no tsconfig anywhere up the tree.
        assert.equal(options.paths, undefined);
        assert.equal(options.allowJs, true);
    } finally {
        rmDir(root);
    }
});

test('extractor resolves @/b to the internal sub/src/b.ts (monorepo, no root tsconfig)', async () => {
    const root = makeMonorepoFixture();
    try {
        const adapter = ParserRegistry.getInstance().getAdapter('typescript')!;
        assert.ok(adapter, 'typescript adapter must be registered');
        const extractor = adapter.createExtractor(root);

        const artifact = await extractor.extract(
            path.join(root, 'sub', 'src', 'a.ts')
        );
        assert.ok(artifact, 'extract returned null');

        const bySource = new Map(
            artifact!.imports.map((i) => [
                i.source,
                i.resolvedPath ? i.resolvedPath.replace(/\\/g, '/') : i.resolvedPath,
            ])
        );

        // The alias import must resolve to the INTERNAL file (not external).
        assert.equal(
            bySource.get('@/b'),
            'sub/src/b.ts',
            '@/b must resolve to the internal sub/src/b.ts'
        );
        // Relative import still resolves.
        assert.equal(
            bySource.get('./b'),
            'sub/src/b.ts',
            './b must resolve to sub/src/b.ts'
        );
        // Genuine external stays external.
        assert.equal(
            bySource.get('react'),
            null,
            "bare 'react' must remain external (resolvedPath null)"
        );
    } finally {
        rmDir(root);
    }
});
