// tests/unit/parser/extractor-content-contract.test.ts
//
// Loop 11 conformance test for the `ArtifactExtractor.extract(filePath, content?)`
// contract. The contract (see `src/parser/interfaces.ts`) says:
//
//   When PROVIDED, the extractor MUST use `content` as the source text and
//   MUST NOT read `filePath` from disk for that file's bytes.
//
// This test enumerates every adapter the runtime registry actually
// registered (skipping ones whose tree-sitter dep isn't installed —
// mirroring `registry-support-truth.test.ts`'s posture), so it agrees with
// the registry's runtime truth and stays green in environments missing
// optional grammars.
//
// For each registered adapter we:
//   1. Write a small fixture to a temp dir.
//   2. Call extract(filePath) (disk read).
//   3. Call extract(filePath, content) (in-memory).
//   4. Assert that a stable summary of both artifacts is identical.
//
// We additionally pin the TypeScript adapter with a load-bearing extra
// case Loop 12 will lean on: `extract(virtualPath, content)` must succeed
// even when `virtualPath` does NOT exist on disk. This verifies the
// in-memory CompilerHost wiring on `TypeScriptExtractor` (Task 2).
//
// On failure: re-read the contract in `src/parser/interfaces.ts`, then
// make the offending extractor honor `content`.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { ParserRegistry } from '../../../src/parser/registry';
import type { FileArtifact } from '../../../src/parser/types';

interface Fixture {
    ext: string;
    content: string;
}

// One fixture per adapter id. If a new adapter shows up in the registry
// without a fixture here, the test fails loudly so the contributor adds one.
const FIXTURES: Record<string, Fixture> = {
    typescript: {
        ext: '.ts',
        content: [
            "import { foo } from './foo';",
            "export const bar = 1;",
            "export function baz() { return foo(); }",
        ].join('\n') + '\n',
    },
    python: {
        ext: '.py',
        content: [
            "import os",
            "from .foo import bar",
            "",
            "def baz():",
            "    return bar()",
            "",
            "class Qux:",
            "    def quux(self): pass",
        ].join('\n') + '\n',
    },
    cpp: {
        ext: '.cpp',
        content: [
            '#include <vector>',
            '#include "local.h"',
            '',
            'int add(int a, int b) { return a + b; }',
            'class Widget { public: void run(); };',
        ].join('\n') + '\n',
    },
    rust: {
        ext: '.rs',
        content: [
            'use std::io::{Read, Write};',
            '',
            'pub fn add(a: i32, b: i32) -> i32 { a + b }',
            '',
            'pub struct Widget { pub value: i32 }',
        ].join('\n') + '\n',
    },
    r: {
        ext: '.R',
        content: [
            'library(dplyr)',
            'source("helpers.R")',
            '',
            'add <- function(a, b) {',
            '    a + b',
            '}',
        ].join('\n') + '\n',
    },
};

/**
 * Stable, comparison-friendly projection of a FileArtifact.
 *
 * Sorts arrays so traversal order doesn't matter. We deliberately omit
 * `loc`/`id`/`callSiteId` (byte-offset based) and `signature` (which
 * includes whitespace details) — equivalence here is "same imports,
 * exports, entities by name/kind", which is the contract surface
 * Option A pins.
 */
function summarize(a: FileArtifact) {
    return {
        file: { id: a.file.id, language: a.file.language },
        imports: [...a.imports]
            .map(i => ({
                source: i.source,
                resolvedPath: i.resolvedPath,
                kind: i.kind,
                specifiers: [...i.specifiers]
                    .map(s => ({ name: s.name, alias: s.alias }))
                    .sort((x, y) => x.name.localeCompare(y.name)),
            }))
            .sort((x, y) => x.source.localeCompare(y.source)),
        exports: [...a.exports]
            .map(e => ({ name: e.name, type: e.type }))
            .sort((x, y) =>
                x.name.localeCompare(y.name) || x.type.localeCompare(y.type)
            ),
        entities: [...a.entities]
            .map(e => ({ name: e.name, kind: e.kind, isExported: e.isExported }))
            .sort((x, y) =>
                x.name.localeCompare(y.name) || x.kind.localeCompare(y.kind)
            ),
    };
}

function makeTempDir(adapterId: string): string {
    const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), `llmem-extract-content-${adapterId}-`)
    );
    return dir;
}

function rmTempDir(dir: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch {
        // best-effort cleanup
    }
}

const adapters = ParserRegistry.getInstance().getAllAdapters();

for (const adapter of adapters) {
    test(`${adapter.id} extractor honors content (matches disk read)`, async () => {
        const fixture = FIXTURES[adapter.id];
        if (!fixture) {
            assert.fail(
                `No fixture defined for adapter '${adapter.id}'. ` +
                `Add one to FIXTURES in tests/unit/parser/extractor-content-contract.test.ts.`
            );
        }

        const tempDir = makeTempDir(adapter.id);
        try {
            const filePath = path.join(tempDir, `sample${fixture.ext}`);
            fs.writeFileSync(filePath, fixture.content, 'utf-8');

            const extractor = adapter.createExtractor(tempDir);

            const aDisk = await extractor.extract(filePath);
            const aMem = await extractor.extract(filePath, fixture.content);

            assert.ok(aDisk, `${adapter.id}: disk-read extraction returned null`);
            assert.ok(aMem, `${adapter.id}: in-memory extraction returned null`);

            assert.deepEqual(
                summarize(aMem!),
                summarize(aDisk!),
                `${adapter.id}: extract(filePath, content) must match extract(filePath) ` +
                `when content equals on-disk bytes`
            );
        } finally {
            rmTempDir(tempDir);
        }
    });
}

// Load-bearing extra assertion for the TypeScript adapter (Task 5 step 6).
// Loop 12's resolver rewrite needs in-memory extraction for files that may
// never touch disk. This test pins that behavior on the TS path that
// Task 2 wired up: `extract(virtualPath, content)` must succeed even when
// `virtualPath` does not exist on disk.
const tsAdapter = ParserRegistry.getInstance().getAdapter('typescript');
if (tsAdapter) {
    test('TypeScript extractor honors content for a non-existent filePath', async () => {
        const tempDir = makeTempDir('typescript-virtual');
        try {
            const virtualPath = path.join(tempDir, 'never-on-disk.ts');
            assert.ok(
                !fs.existsSync(virtualPath),
                'precondition: file must not exist on disk'
            );

            const extractor = tsAdapter.createExtractor(tempDir);
            const artifact = await extractor.extract(
                virtualPath,
                FIXTURES.typescript.content
            );

            assert.ok(
                artifact,
                'extract must return a non-null artifact when content is supplied'
            );
            assert.ok(
                artifact!.entities.some(e => e.name === 'baz'),
                'in-memory content must drive entity extraction'
            );
            assert.ok(
                !fs.existsSync(virtualPath),
                'sanity: extractor must not have written virtualPath to disk'
            );
        } finally {
            rmTempDir(tempDir);
        }
    });
}
