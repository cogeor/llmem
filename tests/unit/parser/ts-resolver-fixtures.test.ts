// tests/unit/parser/ts-resolver-fixtures.test.ts
//
// Loop 12 — pin exact `resolvedPath` values for the seven canonical
// resolver scenarios. Each fixture under
// `tests/fixtures/parser/ts-resolver/{01..07}-*/` exercises one TypeScript
// module-resolution capability:
//
//   01 — tsconfig path aliases (`paths: { "@/*": ["src/*"] }`)
//   02 — `baseUrl` non-relative imports
//   03 — package `exports` field (Node 16+ subpath patterns)
//   04 — directory imports resolving via `index.ts`
//   05 — `.ts` source importing `'./foo.js'` that resolves to `foo.tsx`/.ts
//   06 — re-exports (`export * from`) chain through a barrel
//   07 — external modules (`react`, `vscode`) MUST stay external
//
// On failure the test prints the offending fixture and (source,
// resolvedPath) pair, so the failure message itself names the regression.
//
// If a Loop changes the resolver and shifts a `resolvedPath` value, the
// shift MUST be documented in the loop's IMPLEMENTATION.md ("resolvedPath
// shifts" section) — not silently absorbed by loosening these assertions.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';

import { ParserRegistry } from '../../../src/parser/registry';

interface ExpectedImport {
    source: string;
    resolvedPath: string | null;
}

interface FixtureCase {
    /** Fixture subdirectory under tests/fixtures/parser/ts-resolver/. */
    dir: string;
    /** File to extract, relative to fixture dir. */
    entry: string;
    /** Expected import specs (order-insensitive). */
    expected: ExpectedImport[];
}

const FIXTURES: FixtureCase[] = [
    {
        dir: '01-path-alias',
        entry: 'src/main.ts',
        expected: [
            { source: '@/utils/log', resolvedPath: 'src/utils/log.ts' },
        ],
    },
    {
        dir: '02-base-url',
        entry: 'src/main.ts',
        expected: [
            { source: 'utils/log', resolvedPath: 'src/utils/log.ts' },
        ],
    },
    {
        dir: '03-package-exports',
        entry: 'src/main.ts',
        expected: [
            // Both targets live under node_modules/ → external; resolvedPath null,
            // source preserved verbatim.
            { source: 'pkg', resolvedPath: null },
            { source: 'pkg/sub', resolvedPath: null },
        ],
    },
    {
        dir: '04-index-files',
        entry: 'src/main.ts',
        expected: [
            // './utils' resolves to the directory's index.ts.
            { source: './utils', resolvedPath: 'src/utils/index.ts' },
        ],
    },
    {
        dir: '05-extension-mixing',
        entry: 'src/main.ts',
        expected: [
            // .js specifier resolves to the .js file on disk.
            { source: './legacy.js', resolvedPath: 'src/legacy.js' },
            // No-extension specifier resolves to the .tsx file on disk.
            { source: './widget', resolvedPath: 'src/widget.tsx' },
        ],
    },
    {
        dir: '06-re-exports',
        entry: 'src/main.ts',
        expected: [
            { source: './barrel', resolvedPath: 'src/barrel.ts' },
        ],
    },
    {
        dir: '07-external-stays-external',
        entry: 'src/main.ts',
        expected: [
            // External modules: resolvedPath null, source preserved verbatim.
            { source: 'react', resolvedPath: null },
            { source: 'vscode', resolvedPath: null },
        ],
    },
];

function fixtureRoot(dir: string): string {
    return path.resolve(__dirname, '../../fixtures/parser/ts-resolver', dir);
}

for (const fx of FIXTURES) {
    test(`ts-resolver fixture ${fx.dir} pins resolvedPath`, async () => {
        const root = fixtureRoot(fx.dir);
        const adapter = ParserRegistry.getInstance().getAdapter('typescript')!;
        assert.ok(adapter, 'typescript adapter must be registered');
        const extractor = adapter.createExtractor(root);
        const artifact = await extractor.extract(path.join(root, fx.entry));
        assert.ok(artifact, `${fx.dir}: extract returned null`);

        const got = [...artifact!.imports]
            .map(i => ({
                source: i.source,
                // Force POSIX comparison even if a backslash slipped through.
                resolvedPath: i.resolvedPath
                    ? i.resolvedPath.replace(/\\/g, '/')
                    : i.resolvedPath,
            }))
            .sort((a, b) => a.source.localeCompare(b.source));
        const want = [...fx.expected]
            .sort((a, b) => a.source.localeCompare(b.source));

        assert.deepEqual(got, want, `${fx.dir}: import resolvedPath mismatch`);
    });
}

// Constraint #4 from the loop brief: external module specifiers come back
// VERBATIM (no normalization, no './' prefix added). Guarded explicitly
// here so a future "normalize all sources" refactor would fail loudly.
test('ts-resolver fixture 07-external: source strings come back verbatim', async () => {
    const root = fixtureRoot('07-external-stays-external');
    const adapter = ParserRegistry.getInstance().getAdapter('typescript')!;
    const extractor = adapter.createExtractor(root);
    const artifact = await extractor.extract(path.join(root, 'src/main.ts'));
    assert.ok(artifact);

    const reactImport = artifact!.imports.find(i => i.source === 'react');
    const vscodeImport = artifact!.imports.find(i => i.source === 'vscode');
    assert.ok(reactImport, "react import missing or source string was rewritten");
    assert.ok(vscodeImport, "vscode import missing or source string was rewritten");
    assert.equal(reactImport!.source, 'react');
    assert.equal(vscodeImport!.source, 'vscode');
    assert.equal(reactImport!.resolvedPath, null);
    assert.equal(vscodeImport!.resolvedPath, null);
});

// Specific guard for fixture 05: the `.tsx` resolution from `'./widget'`
// must survive even when no extension is present in the specifier — this
// is the case naive prefix-matching resolvers fail on.
test('ts-resolver fixture 05-extension-mixing: extensionless specifier resolves to .tsx', async () => {
    const root = fixtureRoot('05-extension-mixing');
    const adapter = ParserRegistry.getInstance().getAdapter('typescript')!;
    const extractor = adapter.createExtractor(root);
    const artifact = await extractor.extract(path.join(root, 'src/main.ts'));
    assert.ok(artifact);

    const widgetImport = artifact!.imports.find(i => i.source === './widget');
    assert.ok(widgetImport, "import of './widget' missing");
    assert.equal(
        widgetImport!.resolvedPath?.replace(/\\/g, '/'),
        'src/widget.tsx',
        "extensionless './widget' must resolve to widget.tsx, not widget.ts"
    );
});

// Re-export resolution INSIDE barrel.ts:
// `ExportSpec` does not currently carry a `resolvedSource` field — the
// schema bump for re-export resolution lives in Loop 13. Until then we
// only assert that barrel.ts's two `export * from` statements come back
// as ExportSpec entries with the correct `source` strings. When Loop 13
// adds the field, this test should be extended to assert the resolved
// path matches `src/foo.ts` and `src/bar.ts` respectively.
test('ts-resolver fixture 06-re-exports: barrel.ts re-exports recorded with literal source (Loop 13 schema bump required for resolved field)', async () => {
    const root = fixtureRoot('06-re-exports');
    const adapter = ParserRegistry.getInstance().getAdapter('typescript')!;
    const extractor = adapter.createExtractor(root);
    const artifact = await extractor.extract(path.join(root, 'src/barrel.ts'));
    assert.ok(artifact);

    const sources = artifact!.exports
        .filter(e => e.type === 'all' && e.source)
        .map(e => e.source!)
        .sort();
    assert.deepEqual(sources, ['./bar', './foo']);
});
